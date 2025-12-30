use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("configuration error: {0}")]
    Config(String),
    #[error("upstream error: {0}")]
    Upstream(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match self {
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::Config(_) => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::Upstream(_) => StatusCode::BAD_GATEWAY,
            AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let body = ErrorBody {
            error: self.to_string(),
        };
        (status, Json(body)).into_response()
    }
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    error: String,
}

impl From<crate::llm::LlmError> for AppError {
    fn from(value: crate::llm::LlmError) -> Self {
        match value {
            crate::llm::LlmError::MissingApiKey(msg) => AppError::Config(msg),
            crate::llm::LlmError::InvalidRequest(msg) => AppError::BadRequest(msg),
            crate::llm::LlmError::UnexpectedStatus(_, body) => AppError::Upstream(body),
            crate::llm::LlmError::Http(e) => AppError::Upstream(e.to_string()),
            crate::llm::LlmError::Provider(msg) => AppError::Upstream(msg),
        }
    }
}
