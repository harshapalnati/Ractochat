mod admin;
mod audit;
mod auth;
mod config;
mod db;
mod error;
mod governance;
mod llm;
mod model_router;
mod pii;
mod routes;

use crate::admin::{
    dashboard_overview, list_accounts, list_models, list_policies, set_alias, set_fallbacks,
    test_policy, update_account_guardrail, update_account_limits, update_account_models,
    update_account_status, upsert_model, upsert_policy,
};
use crate::auth::{login, logout};
use crate::config::Config;
use crate::db::Db;
use crate::error::AppError;
use crate::llm::LlmService;
use crate::model_router::{AccessControl, seeded_accounts};
use crate::routes::chat::{chat, chat_stream};
use axum::{
    Router,
    http::{HeaderValue, Method},
    response::IntoResponse,
    routing::{get, post},
};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tracing::{Level, info};

#[tokio::main]
async fn main() -> Result<(), AppError> {
    dotenvy::dotenv().ok();
    init_tracing();

    let config = Config::from_env()?;
    let db = Db::new(&config.database_url).await?;
    let llm = LlmService::new(&config);
    let access = AccessControl::new(seeded_accounts());
    let state = AppState {
        llm,
        db,
        config,
        access,
    };
    let shared_state = state.clone();

    let cors = build_cors(&state.config);

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/v1/chat", post(chat))
        .route("/api/v1/chat/stream", post(chat_stream))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/admin/overview", get(dashboard_overview))
        .route("/api/v1/admin/accounts", get(list_accounts))
        .route(
            "/api/v1/admin/accounts/:id/models",
            post(update_account_models),
        )
        .route(
            "/api/v1/admin/accounts/:id/status",
            post(update_account_status),
        )
        .route(
            "/api/v1/admin/accounts/:id/guardrail",
            post(update_account_guardrail),
        )
        .route(
            "/api/v1/admin/accounts/:id/limits",
            post(update_account_limits),
        )
        .route(
            "/api/v1/admin/policies",
            get(list_policies).post(upsert_policy),
        )
        .route("/api/v1/admin/policies/:id", post(upsert_policy))
        .route("/api/v1/admin/policies/:id/test", post(test_policy))
        .route("/api/v1/admin/models", get(list_models).post(upsert_model))
        .route("/api/v1/admin/models/aliases", post(set_alias))
        .route("/api/v1/admin/models/:id/fallbacks", post(set_fallbacks))
        .with_state(shared_state)
        .layer(cors);

    let addr = format!("{}:{}", state.config.host, state.config.port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| AppError::Internal(format!("failed to bind {addr}: {e}")))?;
    info!(
        "listening on http://{}",
        listener
            .local_addr()
            .map(|a| a.to_string())
            .unwrap_or(addr.clone())
    );

    axum::serve(listener, app.into_make_service())
        .await
        .map_err(|e| AppError::Internal(format!("server error: {e}")))
}

fn init_tracing() {
    tracing_subscriber::fmt()
        .with_max_level(Level::INFO)
        .with_target(false)
        .without_time()
        .init();
}

fn build_cors(config: &Config) -> CorsLayer {
    let mut layer = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([axum::http::header::CONTENT_TYPE])
        .allow_credentials(true);

    if let Some(origins) = config.allowed_origins.clone() {
        let origins: Vec<_> = origins
            .split(',')
            .filter_map(|o| HeaderValue::from_str(o.trim()).ok())
            .collect();
        if !origins.is_empty() {
            layer = layer.allow_origin(origins);
            return layer;
        }
    }

    // Mirror request origin so local dev hosts work without configuring ALLOWED_ORIGINS.
    layer.allow_origin(AllowOrigin::mirror_request())
}

async fn health() -> impl IntoResponse {
    "ok"
}

#[derive(Clone)]
pub struct AppState {
    llm: LlmService,
    db: Db,
    config: Config,
    access: AccessControl,
}
