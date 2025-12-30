use crate::error::AppError;
use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub openai_api_key: Option<String>,
    pub anthropic_api_key: Option<String>,
    pub allowed_origins: Option<String>,
    pub jwt_secret: String,
}

impl Config {
    pub fn from_env() -> Result<Self, AppError> {
        let host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
        let port = env::var("PORT")
            .ok()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(8000);

        let database_url =
            env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://./data/app.db".into());
        let openai_api_key = env::var("OPENAI_API_KEY").ok();
        let anthropic_api_key = env::var("ANTHROPIC_API_KEY").ok();
        let allowed_origins = env::var("ALLOWED_ORIGINS").ok();
        let jwt_secret = env::var("JWT_SECRET").unwrap_or_else(|_| "dev-secret-change-me".into());

        Ok(Self {
            host,
            port,
            database_url,
            openai_api_key,
            anthropic_api_key,
            allowed_origins,
            jwt_secret,
        })
    }
}
