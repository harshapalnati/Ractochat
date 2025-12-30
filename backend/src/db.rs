use crate::{
    error::AppError,
    governance::{Policy, PolicyHit, PolicyHitInsert, PolicyUpsert},
};
use chrono::Utc;
use serde::Serialize;
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
use std::path::Path;
use std::str::FromStr;
use uuid::Uuid;

#[derive(Clone)]
pub struct Db {
    pool: SqlitePool,
}

impl Db {
    pub async fn new(database_url: &str) -> Result<Self, AppError> {
        if let Some(path) = database_url.strip_prefix("sqlite://") {
            if !path.starts_with(":memory:") {
                if let Some(parent) = Path::new(path).parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| AppError::Config(format!("failed to create db dir: {e}")))?;
                }
            }
        }

        let options = SqliteConnectOptions::from_str(database_url)
            .map_err(|e| AppError::Config(format!("invalid DATABASE_URL: {e}")))?
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal);

        let pool = SqlitePool::connect_with(options)
            .await
            .map_err(|e| AppError::Internal(format!("db connect error: {e}")))?;

        sqlx::query("PRAGMA foreign_keys = ON;")
            .execute(&pool)
            .await
            .map_err(map_db_err)?;

        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .map_err(|e| AppError::Internal(format!("migration error: {e}")))?;

        Ok(Self { pool })
    }

    pub async fn ensure_conversation(
        &self,
        id: Uuid,
        title: Option<&str>,
        user_id: Option<&str>,
    ) -> Result<(), AppError> {
        let created_at = Utc::now().to_rfc3339();
        let title = title.unwrap_or("Untitled");
        sqlx::query(
            r#"INSERT OR IGNORE INTO conversations (id, title, user_id, created_at)
               VALUES (?1, ?2, ?3, ?4)"#,
        )
        .bind(id.to_string())
        .bind(title)
        .bind(user_id)
        .bind(created_at)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    pub async fn insert_message(&self, msg: MessageInsert) -> Result<Uuid, AppError> {
        let created_at = Utc::now().to_rfc3339();
        let id = msg.id.unwrap_or_else(Uuid::new_v4);
        sqlx::query(
            r#"INSERT INTO messages
               (id, conversation_id, role, content, provider, model, tokens_input, tokens_output, created_at, user_id)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"#,
        )
        .bind(id.to_string())
        .bind(msg.conversation_id.to_string())
        .bind(msg.role)
        .bind(msg.content)
        .bind(msg.provider)
        .bind(msg.model)
        .bind(msg.tokens_input.map(|v| v as i64))
        .bind(msg.tokens_output.map(|v| v as i64))
        .bind(created_at)
        .bind(msg.user_id)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(id)
    }

    pub async fn counts(&self) -> Result<Counts, AppError> {
        let conversations = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM conversations")
            .fetch_one(&self.pool)
            .await
            .map_err(map_db_err)?;

        let messages = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM messages")
            .fetch_one(&self.pool)
            .await
            .map_err(map_db_err)?;

        let users = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(DISTINCT user_id) FROM conversations WHERE user_id IS NOT NULL",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(Counts {
            conversations,
            messages,
            users,
        })
    }

    pub async fn model_usage(&self) -> Result<Vec<ModelUsage>, AppError> {
        let rows = sqlx::query_as::<_, ModelUsage>(
            r#"
            SELECT
                COALESCE(provider, 'unknown') as provider,
                COALESCE(model, 'unknown') as model,
                COUNT(*) as count
            FROM messages
            WHERE role = 'assistant'
            GROUP BY provider, model
            ORDER BY count DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(rows)
    }

    pub async fn list_policies(&self) -> Result<Vec<Policy>, AppError> {
        let rows = sqlx::query_as::<_, Policy>(
            r#"
            SELECT id, name, description, match_type, pattern, action, applies_to, enabled, created_at
            FROM policies
            ORDER BY created_at DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(rows)
    }

    pub async fn create_or_update_policy(&self, policy: PolicyUpsert) -> Result<Policy, AppError> {
        let id = policy.id.unwrap_or_else(Uuid::new_v4);
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"
            INSERT INTO policies (id, name, description, match_type, pattern, action, applies_to, enabled, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                description=excluded.description,
                match_type=excluded.match_type,
                pattern=excluded.pattern,
                action=excluded.action,
                applies_to=excluded.applies_to,
                enabled=excluded.enabled
            "#,
        )
        .bind(id.to_string())
        .bind(policy.name.clone())
        .bind(policy.description.clone())
        .bind(policy.match_type.clone())
        .bind(policy.pattern.clone())
        .bind(policy.action.clone())
        .bind(policy.applies_to.clone())
        .bind(policy.enabled as i32)
        .bind(now.clone())
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(Policy {
            id: id.to_string(),
            name: policy.name,
            description: policy.description,
            match_type: policy.match_type,
            pattern: policy.pattern,
            action: policy.action,
            applies_to: policy.applies_to,
            enabled: policy.enabled,
            created_at: now,
        })
    }

    pub async fn record_policy_hits(&self, hits: Vec<PolicyHitInsert>) -> Result<(), AppError> {
        if hits.is_empty() {
            return Ok(());
        }
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        for hit in hits {
            let created_at = Utc::now().to_rfc3339();
            sqlx::query(
                r#"
                INSERT INTO policy_hits (id, message_id, policy_id, policy_name, action, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                "#,
            )
            .bind(Uuid::new_v4().to_string())
            .bind(hit.message_id)
            .bind(hit.policy_id)
            .bind(hit.policy_name)
            .bind(hit.action)
            .bind(created_at)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        }
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    pub async fn recent_policy_hits(&self, limit: i64) -> Result<Vec<PolicyHit>, AppError> {
        let rows = sqlx::query_as::<_, PolicyHit>(
            r#"
            SELECT id, message_id, policy_id, policy_name, action, created_at
            FROM policy_hits
            ORDER BY created_at DESC
            LIMIT ?1
            "#,
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(rows)
    }

    pub async fn recent_messages(&self, limit: i64) -> Result<Vec<MessageRecord>, AppError> {
        let rows = sqlx::query_as::<_, MessageRecord>(
            r#"
            SELECT
                id,
                conversation_id,
                role,
                content,
                provider,
                model,
                tokens_input,
                tokens_output,
                user_id,
                created_at
            FROM messages
            ORDER BY created_at DESC
            LIMIT ?1
            "#,
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(rows)
    }
}

pub struct MessageInsert {
    pub id: Option<Uuid>,
    pub conversation_id: Uuid,
    pub role: String,
    pub content: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub tokens_input: Option<u32>,
    pub tokens_output: Option<u32>,
    pub user_id: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct MessageRecord {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub tokens_input: Option<i64>,
    pub tokens_output: Option<i64>,
    pub user_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct Counts {
    pub conversations: i64,
    pub messages: i64,
    pub users: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ModelUsage {
    pub provider: String,
    pub model: String,
    pub count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct UsageStats {
    pub requests: i64,
    pub tokens_input: i64,
    pub tokens_output: i64,
}

fn map_db_err(e: sqlx::Error) -> AppError {
    AppError::Internal(format!("database error: {e}"))
}

impl Db {
    pub async fn usage_since(
        &self,
        user_id: &str,
        since_iso: &str,
    ) -> Result<UsageStats, AppError> {
        let row = sqlx::query_as::<_, UsageStats>(
            r#"
            SELECT
                COUNT(*) as requests,
                COALESCE(SUM(tokens_input), 0) as tokens_input,
                COALESCE(SUM(tokens_output), 0) as tokens_output
            FROM messages
            WHERE user_id = ?1
              AND created_at >= ?2
            "#,
        )
        .bind(user_id)
        .bind(since_iso)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(row)
    }
}
