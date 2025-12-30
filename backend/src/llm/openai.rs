use super::{LlmClient, LlmError, LlmMessage, LlmRequest, LlmResponse, Provider, Role};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct OpenAiClient {
    api_key: String,
    http: reqwest::Client,
}

impl OpenAiClient {
    pub fn new(api_key: String, http: reqwest::Client) -> Self {
        Self { api_key, http }
    }

    fn map_messages(messages: &[LlmMessage]) -> Vec<OpenAiMessage> {
        messages
            .iter()
            .map(|m| OpenAiMessage {
                role: m.role.as_openai().to_string(),
                content: m.content.clone(),
            })
            .collect()
    }
}

#[async_trait]
impl LlmClient for OpenAiClient {
    async fn chat(&self, req: LlmRequest) -> Result<LlmResponse, LlmError> {
        let payload = OpenAiChatRequest {
            model: req.model.clone(),
            messages: Self::map_messages(&req.messages),
            temperature: req.temperature,
            max_tokens: req.max_tokens,
        };

        let response = self
            .http
            .post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(LlmError::UnexpectedStatus(status, body));
        }

        let body: OpenAiChatResponse = response.json().await?;
        let content = body
            .choices
            .first()
            .and_then(|c| c.message.content.clone())
            .unwrap_or_default();

        let (tokens_input, tokens_output) = body
            .usage
            .map(|u| (Some(u.prompt_tokens), Some(u.completion_tokens)))
            .unwrap_or((None, None));

        let cost = super::estimate_cost(Provider::Openai, &req.model, tokens_input, tokens_output);

        Ok(LlmResponse {
            provider: Provider::Openai,
            model: req.model,
            content,
            tokens_input,
            tokens_output,
            cost,
        })
    }
}

#[derive(Debug, Serialize)]
struct OpenAiChatRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(Debug, Serialize)]
struct OpenAiMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatResponse {
    choices: Vec<OpenAiChoice>,
    #[serde(default)]
    usage: Option<OpenAiUsage>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiChatMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatMessage {
    #[serde(rename = "role")]
    _role: String,
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAiUsage {
    prompt_tokens: u32,
    completion_tokens: u32,
}
