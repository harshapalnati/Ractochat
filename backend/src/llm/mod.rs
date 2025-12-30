mod anthropic;
mod openai;

use crate::config::Config;
use async_trait::async_trait;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use std::fmt;
use thiserror::Error;

pub use anthropic::AnthropicClient;
pub use openai::OpenAiClient;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Openai,
    Anthropic,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
}

impl Role {
    fn as_openai(&self) -> &'static str {
        match self {
            Role::System => "system",
            Role::User => "user",
            Role::Assistant => "assistant",
        }
    }

    fn as_anthropic(&self) -> Result<&'static str, LlmError> {
        match self {
            Role::User => Ok("user"),
            Role::Assistant => Ok("assistant"),
            Role::System => Err(LlmError::InvalidRequest(
                "system messages are passed separately for Anthropic".into(),
            )),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LlmMessage {
    pub role: Role,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LlmRequest {
    #[serde(default)]
    pub conversation_id: Option<uuid::Uuid>,
    pub provider: Provider,
    pub model: String,
    pub messages: Vec<LlmMessage>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LlmResponse {
    pub provider: Provider,
    pub model: String,
    pub content: String,
    pub tokens_input: Option<u32>,
    pub tokens_output: Option<u32>,
    pub cost: Option<f64>,
}

#[derive(Debug, Error)]
pub enum LlmError {
    #[error("missing API key: {0}")]
    MissingApiKey(String),
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("upstream error {0}: {1}")]
    UnexpectedStatus(StatusCode, String),
    #[allow(dead_code)]
    #[error("provider error: {0}")]
    Provider(String),
}

#[async_trait]
pub trait LlmClient: Send + Sync {
    async fn chat(&self, req: LlmRequest) -> Result<LlmResponse, LlmError>;
}

#[derive(Clone)]
pub struct LlmService {
    openai: Option<OpenAiClient>,
    anthropic: Option<AnthropicClient>,
}

impl LlmService {
    pub fn new(config: &Config) -> Self {
        let http = reqwest::Client::builder()
            .build()
            .expect("failed to build http client");

        let openai = config
            .openai_api_key
            .as_ref()
            .map(|key| OpenAiClient::new(key.clone(), http.clone()));

        let anthropic = config
            .anthropic_api_key
            .as_ref()
            .map(|key| AnthropicClient::new(key.clone(), http));

        Self { openai, anthropic }
    }

    pub async fn chat(&self, req: LlmRequest) -> Result<LlmResponse, LlmError> {
        match req.provider {
            Provider::Openai => {
                let client = self
                    .openai
                    .as_ref()
                    .ok_or_else(|| LlmError::MissingApiKey("OPENAI_API_KEY not set".into()))?;
                client.chat(req).await
            }
            Provider::Anthropic => {
                let client = self
                    .anthropic
                    .as_ref()
                    .ok_or_else(|| LlmError::MissingApiKey("ANTHROPIC_API_KEY not set".into()))?;
                client.chat(req).await
            }
        }
    }
}

pub fn estimate_cost(
    provider: Provider,
    model: &str,
    tokens_in: Option<u32>,
    tokens_out: Option<u32>,
) -> Option<f64> {
    let (input_rate, output_rate) = match provider {
        Provider::Openai => match model {
            m if m.contains("4.1") => (0.000005, 0.000015),
            m if m.contains("4") => (0.00001, 0.00003),
            _ => (0.000001, 0.000003),
        },
        Provider::Anthropic => match model {
            m if m.contains("sonnet") => (0.000003, 0.000015),
            m if m.contains("haiku") => (0.000001, 0.000003),
            _ => (0.000004, 0.000016),
        },
    };

    let tin = tokens_in.unwrap_or(0) as f64;
    let tout = tokens_out.unwrap_or(0) as f64;
    Some(tin * input_rate + tout * output_rate)
}

impl fmt::Display for Provider {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Provider::Openai => write!(f, "openai"),
            Provider::Anthropic => write!(f, "anthropic"),
        }
    }
}
