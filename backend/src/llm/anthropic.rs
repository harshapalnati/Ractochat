use super::{LlmClient, LlmError, LlmMessage, LlmRequest, LlmResponse, Provider, Role};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct AnthropicClient {
    api_key: String,
    http: reqwest::Client,
}

impl AnthropicClient {
    pub fn new(api_key: String, http: reqwest::Client) -> Self {
        Self { api_key, http }
    }
}

#[async_trait]
impl LlmClient for AnthropicClient {
    async fn chat(&self, req: LlmRequest) -> Result<LlmResponse, LlmError> {
        let (system, messages) = split_system(&req.messages);
        let mapped_messages = map_messages(&messages)?;
        let max_tokens = req.max_tokens.unwrap_or(512);

        let payload = AnthropicChatRequest {
            model: req.model.clone(),
            system,
            messages: mapped_messages,
            max_tokens,
            temperature: req.temperature,
        };

        let response = self
            .http
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&payload)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(LlmError::UnexpectedStatus(status, body));
        }

        let body: AnthropicChatResponse = response.json().await?;
        let content = body
            .content
            .iter()
            .filter_map(|c| c.text.clone())
            .collect::<Vec<_>>()
            .join("");

        let tokens_input = body.usage.as_ref().map(|u| u.input_tokens);
        let tokens_output = body.usage.as_ref().map(|u| u.output_tokens);
        let cost =
            super::estimate_cost(Provider::Anthropic, &req.model, tokens_input, tokens_output);

        Ok(LlmResponse {
            provider: Provider::Anthropic,
            model: req.model,
            content,
            tokens_input,
            tokens_output,
            cost,
        })
    }
}

fn split_system(messages: &[LlmMessage]) -> (Option<String>, Vec<LlmMessage>) {
    let mut system_parts = Vec::new();
    let mut rest = Vec::new();

    for msg in messages {
        match msg.role {
            Role::System => system_parts.push(msg.content.clone()),
            _ => rest.push(msg.clone()),
        }
    }

    let system = if system_parts.is_empty() {
        None
    } else {
        Some(system_parts.join("\n"))
    };

    (system, rest)
}

fn map_messages(messages: &[LlmMessage]) -> Result<Vec<AnthropicMessage>, LlmError> {
    let mut mapped = Vec::with_capacity(messages.len());
    for msg in messages {
        mapped.push(AnthropicMessage {
            role: msg.role.as_anthropic()?.to_string(),
            content: vec![TextBlock {
                r#type: "text".into(),
                text: msg.content.clone(),
            }],
        });
    }
    Ok(mapped)
}

#[derive(Debug, Serialize)]
struct AnthropicChatRequest {
    model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    messages: Vec<AnthropicMessage>,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

#[derive(Debug, Serialize)]
struct AnthropicMessage {
    role: String,
    content: Vec<TextBlock>,
}

#[derive(Debug, Serialize)]
struct TextBlock {
    #[serde(rename = "type")]
    r#type: String,
    text: String,
}

#[derive(Debug, Deserialize)]
struct AnthropicChatResponse {
    content: Vec<AnthropicContent>,
    #[serde(default)]
    usage: Option<AnthropicUsage>,
}

#[derive(Debug, Deserialize)]
struct AnthropicContent {
    #[serde(rename = "type")]
    _type: String,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AnthropicUsage {
    input_tokens: u32,
    output_tokens: u32,
}
