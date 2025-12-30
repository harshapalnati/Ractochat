use crate::{
    AppState,
    audit::{DashboardResponse, build_dashboard},
    error::AppError,
    governance::{Policy, PolicyUpsert, evaluate_policies},
    model_router::{AccountAccess, AccountStatus, AliasTarget, CatalogEntry, ModelPriceCap},
};
use axum::{
    Json,
    extract::{Path, State},
};
use serde::{Deserialize, Serialize};

pub async fn dashboard_overview(
    State(state): State<AppState>,
) -> Result<Json<DashboardResponse>, AppError> {
    let counts = state.db.counts().await?;
    let models = state.db.model_usage().await?;
    let recent = state.db.recent_messages(50).await?;
    let accounts = state.access.list().await;
    let policies = state.db.list_policies().await?;
    let policy_hits = state.db.recent_policy_hits(20).await?;
    let router_health = state.access.router_health();

    let dashboard = build_dashboard(
        counts,
        models,
        recent,
        accounts,
        policies,
        policy_hits,
        router_health,
    );
    Ok(Json(dashboard))
}

pub async fn list_accounts(State(state): State<AppState>) -> Json<Vec<AccountAccess>> {
    Json(state.access.list().await)
}

#[derive(Debug, Deserialize)]
pub struct ModelUpdateBody {
    pub models: Vec<String>,
}

pub async fn update_account_models(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<ModelUpdateBody>,
) -> Result<Json<AccountAccess>, AppError> {
    let updated = state.access.update_models(&id, body.models).await?;
    Ok(Json(updated))
}

#[derive(Debug, Deserialize)]
pub struct StatusUpdateBody {
    pub status: AccountStatus,
}

#[derive(Debug, Deserialize)]
pub struct GuardrailUpdateBody {
    pub guardrail_prompt: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LimitsUpdateBody {
    pub req_per_day: Option<u32>,
    pub tokens_per_day: Option<u32>,
    #[serde(default)]
    pub model_price_caps: Vec<ModelPriceCap>,
}

pub async fn update_account_status(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<StatusUpdateBody>,
) -> Result<Json<AccountAccess>, AppError> {
    let updated = state.access.update_status(&id, body.status).await?;
    Ok(Json(updated))
}

pub async fn update_account_guardrail(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<GuardrailUpdateBody>,
) -> Result<Json<AccountAccess>, AppError> {
    let updated = state
        .access
        .set_guardrail(&id, body.guardrail_prompt)
        .await?;
    Ok(Json(updated))
}

pub async fn update_account_limits(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<LimitsUpdateBody>,
) -> Result<Json<AccountAccess>, AppError> {
    let updated = state
        .access
        .update_limits(
            &id,
            body.req_per_day,
            body.tokens_per_day,
            body.model_price_caps,
        )
        .await?;
    Ok(Json(updated))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelCatalogBody {
    pub id: String,
    pub provider: String,
    pub prompt_price_per_1k: f64,
    pub completion_price_per_1k: f64,
}

pub async fn list_models(State(state): State<AppState>) -> Json<Vec<CatalogEntry>> {
    Json(state.access.list_models().await)
}

pub async fn upsert_model(
    State(state): State<AppState>,
    Json(body): Json<ModelCatalogBody>,
) -> Result<Json<CatalogEntry>, AppError> {
    let entry = CatalogEntry {
        id: body.id.clone(),
        provider: body.provider.clone(),
        prompt_price_per_1k: body.prompt_price_per_1k,
        completion_price_per_1k: body.completion_price_per_1k,
    };
    state.access.upsert_model(entry.clone()).await;
    Ok(Json(entry))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AliasBody {
    pub alias: String,
    pub targets: Vec<AliasTarget>,
}

pub async fn set_alias(
    State(state): State<AppState>,
    Json(body): Json<AliasBody>,
) -> Result<Json<AliasBody>, AppError> {
    state
        .access
        .set_alias(body.alias.clone(), body.targets.clone())
        .await;
    Ok(Json(body))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FallbackBody {
    pub chain: Vec<String>,
}

pub async fn set_fallbacks(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<FallbackBody>,
) -> Result<Json<FallbackBody>, AppError> {
    state.access.set_fallbacks(id, body.chain.clone()).await;
    Ok(Json(body))
}

#[derive(Debug, Deserialize)]
pub struct PolicyInput {
    pub id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub match_type: String,
    pub pattern: String,
    pub action: String,
    pub applies_to: String,
    pub enabled: bool,
}

pub async fn list_policies(State(state): State<AppState>) -> Result<Json<Vec<Policy>>, AppError> {
    let policies = state.db.list_policies().await?;
    Ok(Json(policies))
}

pub async fn upsert_policy(
    State(state): State<AppState>,
    Json(body): Json<PolicyInput>,
) -> Result<Json<Policy>, AppError> {
    let upsert = PolicyUpsert {
        id: body.id.as_ref().and_then(|s| uuid::Uuid::parse_str(s).ok()),
        name: body.name,
        description: body.description,
        match_type: body.match_type,
        pattern: body.pattern,
        action: body.action,
        applies_to: body.applies_to,
        enabled: body.enabled,
    };
    let saved = state.db.create_or_update_policy(upsert).await?;
    Ok(Json(saved))
}

#[derive(Debug, Deserialize)]
pub struct PolicyTestBody {
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct PolicyTestResult {
    pub matched: bool,
    pub action: Option<String>,
    pub redacted: Option<String>,
    pub reason: Option<String>,
}

pub async fn test_policy(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<PolicyTestBody>,
) -> Result<Json<PolicyTestResult>, AppError> {
    let policies = state.db.list_policies().await?;
    let policy = policies
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| AppError::BadRequest("policy not found".into()))?;

    let hits = evaluate_policies(&[policy.clone()], "user", &body.text);
    if let Some(blocked) = hits.blocked {
        return Ok(Json(PolicyTestResult {
            matched: true,
            action: Some(blocked.action),
            redacted: None,
            reason: Some(blocked.policy_name),
        }));
    }
    let first = hits.hits.first();
    Ok(Json(PolicyTestResult {
        matched: first.is_some(),
        action: first.map(|h| h.action.clone()),
        redacted: hits.redacted,
        reason: first.map(|h| h.policy_name.clone()),
    }))
}
