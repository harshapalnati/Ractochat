use axum::{
    Json,
    extract::State,
    response::sse::{Event, Sse},
};
use axum_extra::extract::cookie::CookieJar;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tracing::{info, warn};

use crate::{
    AppError, AppState,
    auth::validate_token,
    db::{MessageInsert, UsageStats},
    governance::{PolicyHitInsert, evaluate_policies},
    llm::{LlmRequest, LlmResponse, LlmService, Provider},
    model_router::{AccessControl, RoutedModel},
    pii::redact,
};

#[derive(Clone, Debug, serde::Serialize)]
pub struct RoutingTrace {
    pub selected_model: String,
    pub provider: String,
    pub attempts: Vec<String>,
    pub used_fallback: bool,
}

#[derive(serde::Serialize)]
pub struct ChatResponse {
    pub conversation_id: uuid::Uuid,
    pub message: LlmResponse,
    pub routing: RoutingTrace,
}

pub async fn chat(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(mut body): Json<LlmRequest>,
) -> Result<Json<ChatResponse>, AppError> {
    if body.messages.is_empty() {
        return Err(AppError::BadRequest("messages cannot be empty".into()));
    }
    let claims = validate_token(&state.config, &jar); // stub optional
    let user_id = claims.as_ref().map(|c| c.sub.clone());
    let plan = state
        .access
        .routing_plan(user_id.as_deref(), &body.model)
        .await?;
    let account = state.access.account(user_id.as_deref()).await;
    if let Some(prompt) = state.access.guardrail_for(user_id.as_deref()).await {
        body.messages.insert(
            0,
            crate::llm::LlmMessage {
                role: crate::llm::Role::System,
                content: prompt,
            },
        );
    }
    enforce_limits(&state.db, account.as_ref(), &plan[0]).await?;
    let policies = state.db.list_policies().await?;
    let conversation_id = body.conversation_id.unwrap_or_else(uuid::Uuid::new_v4);
    state
        .db
        .ensure_conversation(conversation_id, Some("Untitled"), user_id.as_deref())
        .await?;

    let mut policy_hits = Vec::new();
    if let Some(last) = body.messages.last_mut() {
        let eval = evaluate_policies(&policies, "user", &last.content);
        if let Some(blocked) = eval.blocked {
            return Err(AppError::BadRequest(format!(
                "Blocked by policy: {}",
                blocked.policy_name
            )));
        }
        if let Some(red) = eval.redacted {
            last.content = red;
        }
        policy_hits = eval.hits;

        let (redacted, changed) = redact(&last.content);
        last.content = redacted;
        if changed {
            info!("PII redaction applied");
        }
    }

    let user_message_id = state
        .db
        .insert_message(MessageInsert {
            id: None,
            conversation_id,
            role: "user".into(),
            content: body
                .messages
                .last()
                .map(|m| m.content.clone())
                .unwrap_or_default(),
            provider: None,
            model: Some(body.model.clone()),
            tokens_input: None,
            tokens_output: None,
            user_id: user_id.clone(),
        })
        .await?;

    if !policy_hits.is_empty() {
        let inserts: Vec<PolicyHitInsert> = policy_hits
            .into_iter()
            .map(|h| PolicyHitInsert {
                message_id: user_message_id.to_string(),
                policy_id: h.policy_id,
                policy_name: h.policy_name,
                action: h.action,
            })
            .collect();
        let _ = state.db.record_policy_hits(inserts).await;
    }

    let routed = route_with_fallbacks(&state.llm, &state.access, &body, &plan).await?;

    let _ = state
        .db
        .insert_message(MessageInsert {
            id: None,
            conversation_id,
            role: "assistant".into(),
            content: routed.response.content.clone(),
            provider: Some(routed.response.provider.to_string()),
            model: Some(routed.response.model.clone()),
            tokens_input: routed.response.tokens_input,
            tokens_output: routed.response.tokens_output,
            user_id: user_id.clone(),
        })
        .await?;

    Ok(Json(ChatResponse {
        conversation_id,
        message: routed.response,
        routing: routed.trace,
    }))
}

pub async fn chat_stream(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(mut body): Json<LlmRequest>,
) -> Result<Sse<UnboundedReceiverStream<Result<Event, AppError>>>, AppError> {
    if body.messages.is_empty() {
        return Err(AppError::BadRequest("messages cannot be empty".into()));
    }
    let claims = validate_token(&state.config, &jar); // stub optional
    let user_id = claims.as_ref().map(|c| c.sub.clone());
    let plan = state
        .access
        .routing_plan(user_id.as_deref(), &body.model)
        .await?;
    let account = state.access.account(user_id.as_deref()).await;
    if let Some(prompt) = state.access.guardrail_for(user_id.as_deref()).await {
        body.messages.insert(
            0,
            crate::llm::LlmMessage {
                role: crate::llm::Role::System,
                content: prompt,
            },
        );
    }
    enforce_limits(&state.db, account.as_ref(), &plan[0]).await?;
    let policies = state.db.list_policies().await?;
    let conversation_id = body.conversation_id.unwrap_or_else(uuid::Uuid::new_v4);
    state
        .db
        .ensure_conversation(conversation_id, Some("Untitled"), user_id.as_deref())
        .await?;

    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    let llm = state.llm.clone();
    let db = state.db.clone();
    let plan_clone = plan.clone();
    let mut policy_hits = Vec::new();
    if let Some(last) = body.messages.last_mut() {
        let eval = evaluate_policies(&policies, "user", &last.content);
        if let Some(blocked) = eval.blocked {
            return Err(AppError::BadRequest(format!(
                "Blocked by policy: {}",
                blocked.policy_name
            )));
        }
        if let Some(red) = eval.redacted {
            last.content = red;
        }
        policy_hits = eval.hits;

        let (redacted, changed) = redact(&last.content);
        last.content = redacted;
        if changed {
            info!("PII redaction applied");
        }
    }
    let user_message = body
        .messages
        .last()
        .map(|m| m.content.clone())
        .unwrap_or_default();
    tokio::spawn(async move {
        // Send initial comment to establish stream
        if tx.send(Ok(Event::default().comment("start"))).is_err() {
            return;
        }
        let llm_res = route_with_fallbacks(&llm, &state.access, &body, &plan_clone).await;
        match llm_res {
            Ok(res) => {
                let content = res.response.content.clone();
                for chunk in content.as_bytes().chunks(64) {
                    let text = String::from_utf8_lossy(chunk).to_string();
                    if tx.send(Ok(Event::default().data(text))).is_err() {
                        return;
                    }
                }
                let user_message_id = db
                    .insert_message(MessageInsert {
                        id: None,
                        conversation_id,
                        role: "user".into(),
                        content: user_message.clone(),
                        provider: None,
                        model: Some(body.model.clone()),
                        tokens_input: None,
                        tokens_output: None,
                        user_id: user_id.clone(),
                    })
                    .await;
                if let Ok(uid) = user_message_id {
                    if !policy_hits.is_empty() {
                        let inserts: Vec<PolicyHitInsert> = policy_hits
                            .iter()
                            .map(|h| PolicyHitInsert {
                                message_id: uid.to_string(),
                                policy_id: h.policy_id.clone(),
                                policy_name: h.policy_name.clone(),
                                action: h.action.clone(),
                            })
                            .collect();
                        let _ = db.record_policy_hits(inserts).await;
                    }
                }
                let meta = serde_json::json!({
                    "tokens_input": res.response.tokens_input,
                    "tokens_output": res.response.tokens_output,
                    "cost": res.response.cost,
                    "provider": res.response.provider,
                    "model": res.response.model,
                    "routing": res.trace
                });
                let _ = db
                    .insert_message(MessageInsert {
                        id: None,
                        conversation_id,
                        role: "assistant".into(),
                        content: res.response.content.clone(),
                        provider: Some(res.response.provider.to_string()),
                        model: Some(res.response.model.clone()),
                        tokens_input: res.response.tokens_input,
                        tokens_output: res.response.tokens_output,
                        user_id: user_id.clone(),
                    })
                    .await;
                let _ = tx.send(Ok(Event::default().event("done").data(meta.to_string())));
            }
            Err(e) => {
                let err_msg = e.to_string();
                let _ = tx.send(Ok(Event::default().data(format!("Error: {}", err_msg))));
            }
        }
    });

    Ok(Sse::new(UnboundedReceiverStream::new(rx))
        .keep_alive(axum::response::sse::KeepAlive::new()))
}

fn provider_from_str(provider: &str) -> Result<Provider, AppError> {
    match provider {
        "openai" => Ok(Provider::Openai),
        "anthropic" => Ok(Provider::Anthropic),
        other => Err(AppError::BadRequest(format!(
            "unknown provider for model routing: {other}"
        ))),
    }
}

fn should_fallback(err: &AppError) -> bool {
    matches!(err, AppError::Upstream(_) | AppError::Internal(_))
}

struct RoutedResult {
    response: LlmResponse,
    trace: RoutingTrace,
}

fn clamp_request(req: &mut LlmRequest) {
    let max_tokens_cap = match req.provider {
        Provider::Openai => 8192,
        Provider::Anthropic => 8192,
    };
    if let Some(max) = req.max_tokens.as_mut() {
        if *max > max_tokens_cap {
            *max = max_tokens_cap;
        }
    }
    if let Some(temp) = req.temperature.as_mut() {
        if *temp < 0.0 {
            *temp = 0.0;
        } else if *temp > 2.0 {
            *temp = 2.0;
        }
    }
}

async fn enforce_limits(
    db: &crate::db::Db,
    account: Option<&crate::model_router::AccountAccess>,
    primary: &RoutedModel,
) -> Result<(), AppError> {
    let Some(acct) = account else {
        return Ok(());
    };

    if let Some(cap) = acct
        .model_price_caps
        .iter()
        .find(|c| c.model.eq_ignore_ascii_case(&primary.resolved_model))
    {
        if primary.estimate_cents > cap.max_cents as f64 {
            return Err(AppError::BadRequest(
                "requested model exceeds account price cap".into(),
            ));
        }
    }

    if acct.req_per_day.is_none() && acct.tokens_per_day.is_none() {
        return Ok(());
    }

    let cutoff = chrono::Utc::now() - chrono::Duration::hours(24);
    let usage = db
        .usage_since(&acct.id, &cutoff.to_rfc3339())
        .await
        .unwrap_or(UsageStats {
            requests: 0,
            tokens_input: 0,
            tokens_output: 0,
        });

    if let Some(limit) = acct.req_per_day {
        if usage.requests >= limit as i64 {
            return Err(AppError::BadRequest(
                "account request limit reached for today".into(),
            ));
        }
    }

    if let Some(limit) = acct.tokens_per_day {
        let total = usage.tokens_input + usage.tokens_output;
        if total >= limit as i64 {
            return Err(AppError::BadRequest(
                "account token limit reached for today".into(),
            ));
        }
    }

    Ok(())
}

async fn route_with_fallbacks(
    llm: &LlmService,
    router: &AccessControl,
    base: &LlmRequest,
    plan: &[RoutedModel],
) -> Result<RoutedResult, AppError> {
    let mut attempts = Vec::new();
    let mut used_fallback = false;

    for (idx, candidate) in plan.iter().enumerate() {
        for retry in 0..=1 {
            let mut req = base.clone();
            req.model = candidate.resolved_model.clone();
            req.provider = provider_from_str(&candidate.provider)?;
            clamp_request(&mut req);
            attempts.push(format!("{}#{}", candidate.resolved_model, retry + 1));

            let start = std::time::Instant::now();
            let res = llm.chat(req).await;
            match res {
                Ok(resp) => {
                    let elapsed = start.elapsed().as_millis();
                    router.record_health(&candidate.resolved_model, true, elapsed);
                    info!(
                        "routed model {} via {} ({} ms) after {} attempt(s)",
                        candidate.request_label,
                        candidate.resolved_model,
                        elapsed,
                        attempts.len()
                    );
                    return Ok(RoutedResult {
                        response: resp,
                        trace: RoutingTrace {
                            selected_model: candidate.resolved_model.clone(),
                            provider: candidate.provider.clone(),
                            attempts,
                            used_fallback: used_fallback || idx > 0 || retry > 0,
                        },
                    });
                }
                Err(e) => {
                    let app_err: AppError = e.into();
                    let elapsed = start.elapsed().as_millis();
                    router.record_health(&candidate.resolved_model, false, elapsed);
                    let can_retry = retry == 0 && should_fallback(&app_err);
                    let can_fallback = idx + 1 < plan.len() && should_fallback(&app_err);
                    warn!(
                        "model {} attempt {} failed ({}); retry: {}, fallback: {}",
                        candidate.resolved_model,
                        retry + 1,
                        app_err,
                        can_retry,
                        can_fallback
                    );
                    if can_retry {
                        continue;
                    }
                    if can_fallback {
                        used_fallback = true;
                        break;
                    }
                    return Err(app_err);
                }
            }
        }
    }

    Err(AppError::Internal(
        "no available model after routing attempts".into(),
    ))
}
