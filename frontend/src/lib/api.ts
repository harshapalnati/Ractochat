export type ChatProvider = "openai" | "anthropic";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  provider: ChatProvider;
  model: string;
  messages: ChatMessage[];
  conversation_id?: string;
  max_tokens?: number;
  temperature?: number;
}

export interface ChatResponse {
  conversation_id: string;
  message: {
    provider: ChatProvider;
    model: string;
    content: string;
    tokens_input?: number;
    tokens_output?: number;
    cost?: number;
  };
  routing?: RoutingTrace;
}

export interface RoutingTrace {
  selected_model: string;
  provider: string;
  attempts: string[];
  used_fallback: boolean;
}

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:8000";

export async function sendChat(request: ChatRequest): Promise<ChatResponse> {
  const res = await fetch(`${API_URL}/api/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed with ${res.status}`);
  }

  return res.json();
}

export async function streamChat(
  request: ChatRequest,
  onDelta: (text: string) => void
): Promise<{
  tokens_input?: number;
  tokens_output?: number;
  cost?: number;
  provider?: string;
  model?: string;
  routing?: RoutingTrace;
}> {
  const res = await fetch(`${API_URL}/api/v1/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(request),
  });
  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(text || `Streaming request failed with ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let meta: {
    tokens_input?: number;
    tokens_output?: number;
    cost?: number;
    provider?: string;
    model?: string;
    routing?: RoutingTrace;
  } = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const lines = part.split("\n").filter(Boolean);
      let eventType: string | null = null;
      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventType = line.replace("event:", "").trim();
        } else if (line.startsWith("data:")) {
          const data = line.replace("data:", "").trim();
          if (eventType === "done") {
            try {
              meta = JSON.parse(data);
            } catch {
              // ignore
            }
          } else {
            onDelta(data);
          }
        }
      }
    }
  }

  return {
    tokens_input: meta.tokens_input,
    tokens_output: meta.tokens_output,
    cost: meta.cost,
    provider: meta.provider,
    model: meta.model,
    routing: meta.routing,
  };
}
