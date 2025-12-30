use regex::Regex;
use serde::Serialize;

#[derive(Debug, Serialize, sqlx::FromRow, Clone)]
pub struct Policy {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub match_type: String,
    pub pattern: String,
    pub action: String,
    pub applies_to: String,
    pub enabled: bool,
    pub created_at: String,
}

#[derive(Debug)]
pub struct PolicyUpsert {
    pub id: Option<uuid::Uuid>,
    pub name: String,
    pub description: Option<String>,
    pub match_type: String,
    pub pattern: String,
    pub action: String,
    pub applies_to: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PolicyHit {
    pub id: String,
    pub message_id: String,
    pub policy_id: String,
    pub policy_name: String,
    pub action: String,
    pub created_at: String,
}

#[derive(Debug)]
pub struct PolicyHitInsert {
    pub message_id: String,
    pub policy_id: String,
    pub policy_name: String,
    pub action: String,
}

#[derive(Debug, Clone)]
pub struct PolicyHitDraft {
    pub policy_id: String,
    pub policy_name: String,
    pub action: String,
}

#[derive(Debug)]
pub struct PolicyEvalResult {
    pub redacted: Option<String>,
    pub hits: Vec<PolicyHitDraft>,
    pub blocked: Option<PolicyHitDraft>,
}

pub fn evaluate_policies(policies: &[Policy], role: &str, text: &str) -> PolicyEvalResult {
    let mut hits = Vec::new();
    let mut blocked = None;
    let mut current = text.to_string();
    let mut redacted = None;

    for policy in policies {
        if !policy.enabled {
            continue;
        }
        let applies = policy.applies_to.eq_ignore_ascii_case("any")
            || policy.applies_to.eq_ignore_ascii_case(role);
        if !applies {
            continue;
        }

        let matched = match policy.match_type.as_str() {
            "regex" => Regex::new(&policy.pattern)
                .ok()
                .map(|re| re.is_match(&current))
                .unwrap_or(false),
            "contains_all" => policy.pattern.split(',').all(|p| {
                current
                    .to_lowercase()
                    .contains(p.trim().to_lowercase().as_str())
            }),
            _ => policy.pattern.split(',').any(|p| {
                current
                    .to_lowercase()
                    .contains(p.trim().to_lowercase().as_str())
            }),
        };

        if !matched {
            continue;
        }

        let hit = PolicyHitDraft {
            policy_id: policy.id.clone(),
            policy_name: policy.name.clone(),
            action: policy.action.clone(),
        };

        match policy.action.as_str() {
            "block" => {
                blocked = Some(hit);
                break;
            }
            "redact" => {
                let replaced = match policy.match_type.as_str() {
                    "regex" => Regex::new(&policy.pattern)
                        .ok()
                        .map(|re| re.replace_all(&current, "[REDACTED]").to_string())
                        .unwrap_or(current.clone()),
                    _ => current.replace(&policy.pattern, "[REDACTED]"),
                };
                current = replaced;
                redacted = Some(current.clone());
                hits.push(hit);
            }
            _ => {
                hits.push(hit);
            }
        }
    }

    PolicyEvalResult {
        redacted,
        hits,
        blocked,
    }
}
