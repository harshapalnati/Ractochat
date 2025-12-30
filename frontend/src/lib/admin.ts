import { API_URL } from "./api";

export type AccountStatus = "active" | "suspended";

export type AccountAccess = {
  id: string;
  email: string;
  display_name: string;
  allowed_models: string[];
  status: AccountStatus;
  guardrail_prompt?: string | null;
  req_per_day?: number | null;
  tokens_per_day?: number | null;
  model_price_caps?: ModelPriceCap[];
};

export type ProviderUsage = {
  provider: string;
  count: number;
};

export type ModelUsage = {
  provider: string;
  model: string;
  count: number;
};

export type TotalsView = {
  conversations: number;
  messages: number;
  users: number;
  flagged: number;
};

export type RequestEntry = {
  id: string;
  conversation_id: string;
  role: string;
  content_preview: string;
  provider?: string | null;
  model?: string | null;
  user_id?: string | null;
  created_at: string;
  alert?: string | null;
};

export type AlertEntry = {
  message_id: string;
  user_id?: string | null;
  reason: string;
  preview: string;
  created_at: string;
};

export type PolicyAction = "block" | "redact" | "flag";
export type PolicyMatchType = "regex" | "contains_any" | "contains_all";

export type Policy = {
  id: string;
  name: string;
  description?: string | null;
  match_type: PolicyMatchType | string;
  pattern: string;
  action: PolicyAction | string;
  applies_to: string;
  enabled: boolean;
  created_at: string;
};

export type PolicyHit = {
  id: string;
  message_id: string;
  policy_id: string;
  policy_name: string;
  action: string;
  created_at: string;
};

export type RouterHealthEntry = {
  model: string;
  provider: string;
  last_ok: boolean;
  last_latency_ms?: number | null;
  successes: number;
  failures: number;
  updated_at?: string | null;
};

export type CatalogEntry = {
  provider: string;
  id: string;
  prompt_price_per_1k: number;
  completion_price_per_1k: number;
};

export type AliasTarget = {
  model: string;
  weight: number;
};

export type AliasRule = {
  alias: string;
  targets: AliasTarget[];
};

export type ModelPriceCap = {
  model: string;
  max_cents: number;
};

export type DashboardSnapshot = {
  totals: TotalsView;
  providers: ProviderUsage[];
  models: ModelUsage[];
  recent_requests: RequestEntry[];
  alerts: AlertEntry[];
  accounts: AccountAccess[];
  policies: Policy[];
  policy_hits: PolicyHit[];
  router_health: RouterHealthEntry[];
};

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed with ${res.status}`);
  }
  return res.json();
}

export async function fetchDashboard(): Promise<DashboardSnapshot> {
  const res = await fetch(`${API_URL}/api/v1/admin/overview`, {
    cache: "no-store",
    credentials: "include",
  });
  return handleResponse<DashboardSnapshot>(res);
}

export async function updateAccountModels(
  accountId: string,
  models: string[]
): Promise<AccountAccess> {
  const res = await fetch(`${API_URL}/api/v1/admin/accounts/${accountId}/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ models }),
  });
  return handleResponse<AccountAccess>(res);
}

export async function upsertPolicy(policy: Partial<Policy> & { name: string; pattern: string; action: string; match_type: string }): Promise<Policy> {
  const res = await fetch(`${API_URL}/api/v1/admin/policies${policy.id ? `/${policy.id}` : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      ...policy,
      enabled: policy.enabled ?? true,
      applies_to: policy.applies_to ?? "user",
    }),
  });
  return handleResponse<Policy>(res);
}

export async function testPolicy(id: string, text: string): Promise<{ matched: boolean; action?: string; redacted?: string; reason?: string }> {
  const res = await fetch(`${API_URL}/api/v1/admin/policies/${id}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ text }),
  });
  return handleResponse(res);
}

export async function updateAccountStatus(
  accountId: string,
  status: AccountStatus
): Promise<AccountAccess> {
  const res = await fetch(`${API_URL}/api/v1/admin/accounts/${accountId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ status }),
  });
  return handleResponse<AccountAccess>(res);
}

export async function updateAccountGuardrail(
  accountId: string,
  guardrail_prompt: string | null
): Promise<AccountAccess> {
  const res = await fetch(`${API_URL}/api/v1/admin/accounts/${accountId}/guardrail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ guardrail_prompt }),
  });
  return handleResponse<AccountAccess>(res);
}

export async function updateAccountLimits(
  accountId: string,
  limits: { req_per_day?: number | null; tokens_per_day?: number | null; model_price_caps?: ModelPriceCap[] }
): Promise<AccountAccess> {
  const res = await fetch(`${API_URL}/api/v1/admin/accounts/${accountId}/limits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      req_per_day: limits.req_per_day ?? null,
      tokens_per_day: limits.tokens_per_day ?? null,
      model_price_caps: limits.model_price_caps ?? [],
    }),
  });
  return handleResponse<AccountAccess>(res);
}

export async function listModels(): Promise<CatalogEntry[]> {
  const res = await fetch(`${API_URL}/api/v1/admin/models`, {
    credentials: "include",
  });
  return handleResponse(res);
}

export async function upsertModel(entry: CatalogEntry): Promise<CatalogEntry> {
  const res = await fetch(`${API_URL}/api/v1/admin/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(entry),
  });
  return handleResponse(res);
}

export async function setAlias(alias: string, targets: AliasTarget[]): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/admin/models/aliases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ alias, targets }),
  });
  await handleResponse(res);
}

export async function setFallbacks(modelId: string, chain: string[]): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/admin/models/${modelId}/fallbacks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ chain }),
  });
  await handleResponse(res);
}
