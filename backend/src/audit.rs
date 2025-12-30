use crate::{
    db::{Counts, MessageRecord, ModelUsage},
    governance::{Policy, PolicyHit},
    model_router::{AccountAccess, RouterHealthEntry},
};
use regex::Regex;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct DashboardResponse {
    pub totals: TotalsView,
    pub providers: Vec<ProviderUsage>,
    pub models: Vec<ModelUsage>,
    pub recent_requests: Vec<RequestEntry>,
    pub alerts: Vec<AlertEntry>,
    pub accounts: Vec<AccountAccess>,
    pub policies: Vec<Policy>,
    pub policy_hits: Vec<PolicyHit>,
    pub router_health: Vec<RouterHealthEntry>,
}

#[derive(Debug, Serialize)]
pub struct TotalsView {
    pub conversations: i64,
    pub messages: i64,
    pub users: i64,
    pub flagged: usize,
}

#[derive(Debug, Serialize)]
pub struct ProviderUsage {
    pub provider: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct RequestEntry {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content_preview: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub user_id: Option<String>,
    pub created_at: String,
    pub alert: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AlertEntry {
    pub message_id: String,
    pub user_id: Option<String>,
    pub reason: String,
    pub preview: String,
    pub created_at: String,
}

pub fn build_dashboard(
    counts: Counts,
    models: Vec<ModelUsage>,
    recent: Vec<MessageRecord>,
    accounts: Vec<AccountAccess>,
    policies: Vec<Policy>,
    policy_hits: Vec<PolicyHit>,
    router_health: Vec<RouterHealthEntry>,
) -> DashboardResponse {
    let requests = recent.iter().map(message_to_request).collect::<Vec<_>>();

    let alerts = requests
        .iter()
        .filter_map(|r| {
            r.alert.as_ref().map(|reason| AlertEntry {
                message_id: r.id.clone(),
                user_id: r.user_id.clone(),
                reason: reason.clone(),
                preview: r.content_preview.clone(),
                created_at: r.created_at.clone(),
            })
        })
        .collect::<Vec<_>>();

    let mut all_alerts = alerts;
    for hit in &policy_hits {
        all_alerts.push(AlertEntry {
            message_id: hit.message_id.clone(),
            user_id: None,
            reason: format!("Policy {} ({})", hit.policy_name, hit.action),
            preview: "".into(),
            created_at: hit.created_at.clone(),
        });
    }

    let providers = models
        .iter()
        .fold(Vec::<ProviderUsage>::new(), |mut acc, m| {
            if let Some(existing) = acc.iter_mut().find(|p| p.provider == m.provider) {
                existing.count += m.count;
            } else {
                acc.push(ProviderUsage {
                    provider: m.provider.clone(),
                    count: m.count,
                });
            }
            acc
        });

    DashboardResponse {
        totals: TotalsView {
            conversations: counts.conversations,
            messages: counts.messages,
            users: counts.users,
            flagged: all_alerts.len(),
        },
        providers,
        models,
        recent_requests: requests,
        alerts: all_alerts,
        accounts,
        policies,
        policy_hits,
        router_health,
    }
}

pub fn message_to_request(m: &MessageRecord) -> RequestEntry {
    let alert = detect_alert(&m.role, &m.content);
    RequestEntry {
        id: m.id.clone(),
        conversation_id: m.conversation_id.clone(),
        role: m.role.clone(),
        content_preview: shorten(&m.content, 180),
        provider: m.provider.clone(),
        model: m.model.clone(),
        user_id: m.user_id.clone(),
        created_at: m.created_at.clone(),
        alert,
    }
}

fn shorten(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    format!("{}...", &text[..max.saturating_sub(3)])
}

fn detect_alert(role: &str, text: &str) -> Option<String> {
    if role != "user" {
        return None;
    }

    let lower = text.to_lowercase();
    let script_like = Regex::new(r"<\s*(script|style|iframe)").unwrap();
    let sql_like = Regex::new(r"\b(drop table|delete from|insert into)\b").unwrap();
    let ui_like = Regex::new(r"\b(click|press|ui|button|modal|form)\b").unwrap();
    let pii_placeholder = lower.contains("[redacted]");
    let pii_like = Regex::new(r"\b(?:\d[ -]*?){13,16}\b|\b\d{3}-\d{2}-\d{4}\b").unwrap();

    if pii_placeholder {
        return Some("PII was redacted from this request".into());
    }
    if pii_like.is_match(&lower) {
        return Some("Looks like unredacted PII (card/SSN-like pattern)".into());
    }
    if script_like.is_match(&lower) {
        return Some("Script/markup content in prompt".into());
    }
    if sql_like.is_match(&lower) {
        return Some("SQL-like command detected".into());
    }
    if ui_like.is_match(&lower) && lower.contains("request") {
        return Some("Looks like a UI-layer request".into());
    }
    if lower.len() > 1200 {
        return Some("Unusually long request".into());
    }
    None
}
