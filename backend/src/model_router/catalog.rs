use rand::{Rng, thread_rng};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, RwLock as StdRwLock},
    time::SystemTime,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CatalogEntry {
    pub provider: String,
    pub id: String,
    pub prompt_price_per_1k: f64,
    pub completion_price_per_1k: f64,
}

impl CatalogEntry {
    pub fn new(
        provider: &str,
        id: &str,
        prompt_price_cents: f64,
        completion_price_cents: f64,
    ) -> Self {
        Self {
            provider: provider.into(),
            id: id.into(),
            prompt_price_per_1k: prompt_price_cents,
            completion_price_per_1k: completion_price_cents,
        }
    }

    pub fn estimate_cents(&self) -> f64 {
        self.prompt_price_per_1k + self.completion_price_per_1k
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AliasTarget {
    pub model: String,
    pub weight: u32,
}

impl AliasTarget {
    pub fn new(model: &str, weight: u32) -> Self {
        Self {
            model: model.into(),
            weight,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct RoutedModel {
    pub request_label: String,
    pub resolved_model: String,
    pub provider: String,
    pub estimate_cents: f64,
    pub fallback_chain: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RouterHealthEntry {
    pub model: String,
    pub provider: String,
    pub last_ok: bool,
    pub last_latency_ms: Option<u128>,
    pub successes: u64,
    pub failures: u64,
    pub updated_at: Option<SystemTime>,
}

#[derive(Clone)]
pub struct Catalog {
    state: Arc<StdRwLock<CatalogState>>,
}

#[derive(Clone)]
struct CatalogState {
    models: HashMap<String, CatalogEntry>,
    aliases: HashMap<String, AliasRule>,
    fallbacks: HashMap<String, Vec<String>>,
    health: HashMap<String, HealthStat>,
}

impl Catalog {
    pub fn seed() -> Self {
        let mut models: HashMap<String, CatalogEntry> = HashMap::new();
        models.insert(
            "gpt-4-turbo-preview".into(),
            CatalogEntry::new("openai", "gpt-4-turbo-preview", 0.5, 4.0),
        );
        models.insert(
            "claude-3.5-sonnet".into(),
            CatalogEntry::new("anthropic", "claude-3-5-sonnet-20240620", 0.3, 3.5),
        );
        models.insert(
            "claude-3-haiku".into(),
            CatalogEntry::new("anthropic", "claude-3-haiku-20240307", 0.08, 3.0),
        );

        let mut aliases = HashMap::new();
        aliases.insert(
            "gpt-4.1".into(),
            AliasRule {
                targets: vec![AliasTarget::new("gpt-4-turbo-preview", 100)],
            },
        );
        aliases.insert(
            "gpt-latest".into(),
            AliasRule {
                targets: vec![AliasTarget::new("gpt-4-turbo-preview", 100)],
            },
        );
        aliases.insert(
            "cheap".into(),
            AliasRule {
                targets: vec![AliasTarget::new("gpt-4o-mini", 100)],
            },
        );
        aliases.insert(
            "ops-fast".into(),
            AliasRule {
                targets: vec![AliasTarget::new("claude-3-haiku-20240307", 100)],
            },
        );

        let mut fallbacks = HashMap::new();
        fallbacks.insert(
            "gpt-4-turbo-preview".into(),
            vec!["gpt-4o-mini".into(), "claude-3-5-sonnet-20240620".into()],
        );
        fallbacks.insert(
            "claude-3-5-sonnet-20240620".into(),
            vec!["claude-3-haiku-20240307".into(), "gpt-4o-mini".into()],
        );

        let mut health = HashMap::new();
        for key in models.keys() {
            health.insert(key.clone(), HealthStat::default());
        }

        Self {
            state: Arc::new(StdRwLock::new(CatalogState {
                models,
                aliases,
                fallbacks,
                health,
            })),
        }
    }

    pub fn resolve(&self, requested: &str, allowlist: &[String]) -> Option<RoutedModel> {
        let state = self.state.read().ok()?;
        let target = state
            .pick_alias(requested)
            .unwrap_or_else(|| requested.to_string());

        let allow_lower: Vec<String> = allowlist.iter().map(|m| m.to_lowercase()).collect();
        let mut candidates: Vec<&CatalogEntry> = Vec::new();
        if allow_lower.iter().any(|m| m == &target.to_lowercase()) {
            if let Some(entry) = state.models.get(&target) {
                candidates.push(entry);
            }
        }

        let mut chain = state.fallbacks.get(&target).cloned().unwrap_or_default();
        chain.retain(|m| allow_lower.iter().any(|al| al == &m.to_lowercase()));
        for fb in &chain {
            if let Some(entry) = state.models.get(fb) {
                candidates.push(entry);
            }
        }

        candidates.sort_by(|a, b| {
            let ha = state.health.get(&a.id).cloned().unwrap_or_default();
            let hb = state.health.get(&b.id).cloned().unwrap_or_default();
            ha.cmp(&hb)
        });

        let entry = candidates.first()?;
        let remaining: Vec<String> = chain.into_iter().filter(|m| m != &entry.id).collect();

        Some(RoutedModel {
            request_label: requested.to_string(),
            resolved_model: entry.id.clone(),
            provider: entry.provider.clone(),
            estimate_cents: entry.estimate_cents(),
            fallback_chain: remaining,
        })
    }

    pub fn all_aliases(&self) -> Vec<String> {
        if let Ok(state) = self.state.read() {
            let mut keys: Vec<String> = state
                .models
                .keys()
                .chain(state.aliases.keys())
                .cloned()
                .collect();
            keys.sort();
            keys
        } else {
            Vec::new()
        }
    }

    pub async fn upsert_model(&self, entry: CatalogEntry) {
        if let Ok(mut state) = self.state.write() {
            state.health.entry(entry.id.clone()).or_default();
            state.models.insert(entry.id.clone(), entry);
        }
    }

    pub async fn set_alias(&self, alias: String, targets: Vec<AliasTarget>) {
        if let Ok(mut state) = self.state.write() {
            state.aliases.insert(alias, AliasRule { targets });
        }
    }

    pub async fn set_fallbacks(&self, model: String, chain: Vec<String>) {
        if let Ok(mut state) = self.state.write() {
            state.fallbacks.insert(model, chain);
        }
    }

    pub fn entry(&self, id: &str) -> Option<CatalogEntry> {
        let state = self.state.read().ok()?;
        state.models.get(id).cloned()
    }

    pub fn list_models(&self) -> Vec<CatalogEntry> {
        let state = self.state.read().ok();
        state
            .map(|s| s.models.values().cloned().collect())
            .unwrap_or_default()
    }

    pub fn record_health(&self, model: &str, ok: bool, latency_ms: u128) {
        if let Ok(mut state) = self.state.write() {
            let entry = state.health.entry(model.to_string()).or_default();
            entry.last_ok = ok;
            entry.last_latency_ms = Some(latency_ms);
            entry.updated_at = Some(SystemTime::now());
            if ok {
                entry.successes += 1;
            } else {
                entry.failures += 1;
            }
        }
    }

    pub fn health_snapshot(&self) -> Vec<RouterHealthEntry> {
        if let Ok(state) = self.state.read() {
            let mut entries = Vec::new();
            for (model, stat) in &state.health {
                if let Some(meta) = state.models.get(model) {
                    entries.push(RouterHealthEntry {
                        model: model.clone(),
                        provider: meta.provider.clone(),
                        last_ok: stat.last_ok,
                        last_latency_ms: stat.last_latency_ms,
                        successes: stat.successes,
                        failures: stat.failures,
                        updated_at: stat.updated_at,
                    });
                }
            }
            entries
        } else {
            Vec::new()
        }
    }
}

impl CatalogState {
    fn pick_alias(&self, alias: &str) -> Option<String> {
        self.aliases
            .get(&alias.to_lowercase())
            .and_then(|rule| rule.pick())
    }
}

#[derive(Clone)]
struct AliasRule {
    targets: Vec<AliasTarget>,
}

impl AliasRule {
    fn pick(&self) -> Option<String> {
        let total: u32 = self.targets.iter().map(|t| t.weight).sum();
        if total == 0 {
            return None;
        }
        let mut rng = thread_rng();
        let mut roll = rng.gen_range(0..total);
        for target in &self.targets {
            if roll < target.weight {
                return Some(target.model.clone());
            }
            roll -= target.weight;
        }
        None
    }
}

#[derive(Clone, Debug, Default)]
struct HealthStat {
    last_latency_ms: Option<u128>,
    last_ok: bool,
    updated_at: Option<SystemTime>,
    successes: u64,
    failures: u64,
}

impl HealthStat {
    fn score(&self) -> (i32, u128) {
        let ok_score = if self.last_ok { 0 } else { 1 };
        let latency = self.last_latency_ms.unwrap_or(u128::MAX);
        (ok_score, latency)
    }
}

impl PartialEq for HealthStat {
    fn eq(&self, other: &Self) -> bool {
        self.score() == other.score()
    }
}

impl Eq for HealthStat {}

impl PartialOrd for HealthStat {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for HealthStat {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.score().cmp(&other.score())
    }
}
