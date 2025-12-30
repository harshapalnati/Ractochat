use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

use super::catalog::{AliasTarget, Catalog, CatalogEntry, RoutedModel, RouterHealthEntry};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AccountStatus {
    Active,
    Suspended,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ModelPriceCap {
    pub model: String,
    pub max_cents: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AccountAccess {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub allowed_models: Vec<String>,
    pub status: AccountStatus,
    pub default_model: Option<String>,
    pub max_cost_cents: Option<u32>,
    pub guardrail_prompt: Option<String>,
    pub req_per_day: Option<u32>,
    pub tokens_per_day: Option<u32>,
    pub model_price_caps: Vec<ModelPriceCap>,
}

#[derive(Clone)]
pub struct AccessControl {
    accounts: Arc<RwLock<Vec<AccountAccess>>>,
    catalog: Catalog,
}

impl AccessControl {
    pub fn new(seed: Vec<AccountAccess>) -> Self {
        Self {
            accounts: Arc::new(RwLock::new(seed)),
            catalog: Catalog::seed(),
        }
    }

    pub async fn list(&self) -> Vec<AccountAccess> {
        self.accounts.read().await.clone()
    }

    pub async fn resolve_model(
        &self,
        user_id: Option<&str>,
        requested: &str,
    ) -> Result<RoutedModel, AppError> {
        let accounts = self.accounts.read().await;
        let account = user_id.and_then(|uid| accounts.iter().find(|a| a.id == uid));
        let allowlist = account
            .map(|a| a.allowed_models.clone())
            .unwrap_or_else(|| self.catalog.all_aliases());

        let picked = self.catalog.resolve(requested, &allowlist).ok_or_else(|| {
            AppError::BadRequest(format!(
                "model '{}' not allowed or not available",
                requested
            ))
        })?;

        if let Some(acct) = account {
            if acct.status != AccountStatus::Active {
                return Err(AppError::BadRequest("account suspended".into()));
            }
            if let Some(max_cents) = acct.max_cost_cents {
                if picked.estimate_cents > max_cents as f64 {
                    return Err(AppError::BadRequest(
                        "requested model exceeds account cost limit".into(),
                    ));
                }
            }
        }

        Ok(picked)
    }

    pub async fn routing_plan(
        &self,
        user_id: Option<&str>,
        requested: &str,
    ) -> Result<Vec<RoutedModel>, AppError> {
        let routed = self.resolve_model(user_id, requested).await?;
        let mut plan = vec![routed.clone()];
        for fb in &routed.fallback_chain {
            if let Some(entry) = self.catalog.entry(fb) {
                plan.push(RoutedModel {
                    request_label: requested.to_string(),
                    resolved_model: entry.id.clone(),
                    provider: entry.provider.clone(),
                    estimate_cents: entry.estimate_cents(),
                    fallback_chain: Vec::new(),
                });
            }
        }
        Ok(plan)
    }

    pub async fn list_models(&self) -> Vec<CatalogEntry> {
        self.catalog.list_models()
    }

    pub async fn upsert_model(&self, entry: CatalogEntry) {
        self.catalog.upsert_model(entry).await;
    }

    pub async fn set_alias(&self, alias: String, targets: Vec<AliasTarget>) {
        self.catalog.set_alias(alias, targets).await;
    }

    pub async fn set_fallbacks(&self, model: String, chain: Vec<String>) {
        self.catalog.set_fallbacks(model, chain).await;
    }

    pub fn record_health(&self, model: &str, ok: bool, latency_ms: u128) {
        self.catalog.record_health(model, ok, latency_ms);
    }

    pub fn router_health(&self) -> Vec<RouterHealthEntry> {
        self.catalog.health_snapshot()
    }

    pub async fn set_guardrail(
        &self,
        id: &str,
        guardrail_prompt: Option<String>,
    ) -> Result<AccountAccess, AppError> {
        let mut accounts = self.accounts.write().await;
        let account = accounts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| AppError::BadRequest(format!("account {id} not found")))?;
        account.guardrail_prompt = guardrail_prompt;
        Ok(account.clone())
    }

    pub async fn guardrail_for(&self, id: Option<&str>) -> Option<String> {
        let accounts = self.accounts.read().await;
        let account = id.and_then(|uid| accounts.iter().find(|a| a.id == uid));
        account.and_then(|a| a.guardrail_prompt.clone())
    }

    pub async fn account(&self, id: Option<&str>) -> Option<AccountAccess> {
        let accounts = self.accounts.read().await;
        id.and_then(|uid| accounts.iter().find(|a| a.id == uid).cloned())
    }

    pub async fn update_limits(
        &self,
        id: &str,
        req_per_day: Option<u32>,
        tokens_per_day: Option<u32>,
        caps: Vec<ModelPriceCap>,
    ) -> Result<AccountAccess, AppError> {
        let mut accounts = self.accounts.write().await;
        let account = accounts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| AppError::BadRequest(format!("account {id} not found")))?;
        account.req_per_day = req_per_day;
        account.tokens_per_day = tokens_per_day;
        account.model_price_caps = caps;
        Ok(account.clone())
    }

    pub async fn update_models(
        &self,
        id: &str,
        models: Vec<String>,
    ) -> Result<AccountAccess, AppError> {
        let mut accounts = self.accounts.write().await;
        let account = accounts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| AppError::BadRequest(format!("account {id} not found")))?;
        let mut filtered = models
            .into_iter()
            .filter(|m| !m.trim().is_empty())
            .collect::<Vec<_>>();
        filtered.sort();
        filtered.dedup();
        account.allowed_models = filtered;
        Ok(account.clone())
    }

    pub async fn update_status(
        &self,
        id: &str,
        status: AccountStatus,
    ) -> Result<AccountAccess, AppError> {
        let mut accounts = self.accounts.write().await;
        let account = accounts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| AppError::BadRequest(format!("account {id} not found")))?;
        account.status = status;
        Ok(account.clone())
    }

    #[allow(dead_code)]
    pub async fn update_default_model(
        &self,
        id: &str,
        model: Option<String>,
    ) -> Result<AccountAccess, AppError> {
        let mut accounts = self.accounts.write().await;
        let account = accounts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| AppError::BadRequest(format!("account {id} not found")))?;
        account.default_model = model;
        Ok(account.clone())
    }

    #[allow(dead_code)]
    pub async fn update_cost_limit(
        &self,
        id: &str,
        max_cost_cents: Option<u32>,
    ) -> Result<AccountAccess, AppError> {
        let mut accounts = self.accounts.write().await;
        let account = accounts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| AppError::BadRequest(format!("account {id} not found")))?;
        account.max_cost_cents = max_cost_cents;
        Ok(account.clone())
    }
}

pub fn seeded_accounts() -> Vec<AccountAccess> {
    vec![
        AccountAccess {
            id: "demo-user".into(),
            email: "demo@local".into(),
            display_name: "Demo User".into(),
            allowed_models: vec![
                "gpt-4.1".into(),
                "gpt-4o-mini".into(),
                "claude-3.5-sonnet".into(),
            ],
            status: AccountStatus::Active,
            default_model: Some("gpt-latest".into()),
            max_cost_cents: Some(10),
            guardrail_prompt: Some("You are a helpful assistant. Refuse to return secrets, credentials, or unsafe code. Keep responses concise.".into()),
            req_per_day: Some(500),
            tokens_per_day: Some(500_000),
            model_price_caps: vec![
                ModelPriceCap {
                    model: "gpt-4.1".into(),
                    max_cents: 50,
                },
                ModelPriceCap {
                    model: "claude-3.5-sonnet".into(),
                    max_cents: 30,
                },
            ],
        },
        AccountAccess {
            id: "ops-team".into(),
            email: "ops@internal".into(),
            display_name: "Ops Team".into(),
            allowed_models: vec![
                "gpt-4.1".into(),
                "claude-3.5-sonnet".into(),
                "claude-3-haiku".into(),
            ],
            status: AccountStatus::Active,
            default_model: Some("ops-fast".into()),
            max_cost_cents: None,
            guardrail_prompt: Some("You assist the ops team. Be precise, avoid hallucinations, and flag risky actions.".into()),
            req_per_day: Some(2000),
            tokens_per_day: Some(2_000_000),
            model_price_caps: vec![],
        },
        AccountAccess {
            id: "guest".into(),
            email: "guest@example.com".into(),
            display_name: "Guest".into(),
            allowed_models: vec!["gpt-4o-mini".into()],
            status: AccountStatus::Suspended,
            default_model: Some("gpt-4o-mini".into()),
            max_cost_cents: Some(2),
            guardrail_prompt: Some("Do not answer with sensitive data. Keep replies short and safe for guests.".into()),
            req_per_day: Some(50),
            tokens_per_day: Some(50_000),
            model_price_caps: vec![
                ModelPriceCap {
                    model: "gpt-4o-mini".into(),
                    max_cents: 5,
                },
            ],
        },
    ]
}
