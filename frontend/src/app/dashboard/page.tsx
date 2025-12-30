"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  fetchDashboard,
  testPolicy,
  updateAccountModels,
  updateAccountStatus,
  updateAccountGuardrail,
  updateAccountLimits,
  upsertPolicy,
  listModels,
  upsertModel,
  setAlias,
  setFallbacks,
  type AccountAccess,
  type DashboardSnapshot,
  type Policy,
  type CatalogEntry,
  type AliasTarget,
} from "@/lib/admin";

const accent = {
  cyan: "from-cyan-400/40 to-emerald-400/20 text-cyan-50",
  amber: "from-amber-400/40 to-orange-500/30 text-amber-50",
  rose: "from-rose-500/40 to-pink-500/30 text-rose-50",
  violet: "from-violet-400/40 to-indigo-500/30 text-indigo-50",
};

import { AppShell } from "@/components/layout/AppShell";

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [guardrailDrafts, setGuardrailDrafts] = useState<Record<string, string>>({});
  const [limitDrafts, setLimitDrafts] = useState<
    Record<string, { req?: string; tokens?: string; capModel?: string; capCents?: string; caps: { model: string; max_cents: number }[] }>
  >({});
  const [updatingAccount, setUpdatingAccount] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [aliasForm, setAliasForm] = useState<{ alias: string; targets: AliasTarget[] }>({
    alias: "",
    targets: [],
  });
  const [fallbackDrafts, setFallbackDrafts] = useState<Record<string, string>>({});
  const [newModel, setNewModel] = useState<CatalogEntry>({
    id: "",
    provider: "openai",
    prompt_price_per_1k: 0,
    completion_price_per_1k: 0,
  });
  const [policyForm, setPolicyForm] = useState({
    name: "",
    description: "",
    match_type: "contains_any",
    pattern: "",
    action: "flag",
    applies_to: "user",
  });
  const [policyTest, setPolicyTest] = useState({ policyId: "", text: "", result: "" });
  const [updatingPolicy, setUpdatingPolicy] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [dash, models] = await Promise.all([fetchDashboard(), listModels()]);
        if (mounted) {
          setData(dash);
          setCatalog(models);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          const message = err instanceof Error ? err.message : "Failed to load dashboard";
          setError(message);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const providerTotal = useMemo(() => {
    if (!data) return 0;
    return data.providers.reduce((sum, p) => sum + p.count, 0);
  }, [data]);

  const handleRemoveModel = async (account: AccountAccess, model: string) => {
    setUpdatingAccount(account.id);
    try {
      const updated = await updateAccountModels(
        account.id,
        account.allowed_models.filter((m) => m !== model)
      );
      setData((prev) =>
        prev
          ? {
              ...prev,
              accounts: prev.accounts.map((a) => (a.id === updated.id ? updated : a)),
            }
          : prev
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update models");
    } finally {
      setUpdatingAccount(null);
    }
  };

  const handleAddModel = async (account: AccountAccess) => {
    const draft = drafts[account.id]?.trim();
    if (!draft) return;
    setUpdatingAccount(account.id);
    try {
      const updated = await updateAccountModels(account.id, [
        ...account.allowed_models,
        draft,
      ]);
      setData((prev) =>
        prev
          ? {
              ...prev,
              accounts: prev.accounts.map((a) => (a.id === updated.id ? updated : a)),
            }
          : prev
      );
      setDrafts((prev) => ({ ...prev, [account.id]: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update models");
    } finally {
      setUpdatingAccount(null);
    }
  };

  const handleToggleStatus = async (account: AccountAccess) => {
    setUpdatingAccount(account.id);
    try {
      const next = account.status === "active" ? "suspended" : "active";
      const updated = await updateAccountStatus(account.id, next);
      setData((prev) =>
        prev
          ? {
              ...prev,
              accounts: prev.accounts.map((a) => (a.id === updated.id ? updated : a)),
            }
          : prev
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setUpdatingAccount(null);
    }
  };

  const handleSaveGuardrail = async (account: AccountAccess) => {
    setUpdatingAccount(account.id);
    try {
      const updated = await updateAccountGuardrail(
        account.id,
        guardrailDrafts[account.id] ?? account.guardrail_prompt ?? ""
      );
      setData((prev) =>
        prev
          ? {
              ...prev,
              accounts: prev.accounts.map((a) => (a.id === updated.id ? updated : a)),
            }
          : prev
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update guardrail");
    } finally {
      setUpdatingAccount(null);
    }
  };

  const handleSaveLimits = async (account: AccountAccess) => {
    setUpdatingAccount(account.id);
    const draft = limitDrafts[account.id];
    const req = draft?.req ? Number(draft.req) : account.req_per_day ?? null;
    const tokens = draft?.tokens ? Number(draft.tokens) : account.tokens_per_day ?? null;
    const caps = draft?.caps ?? account.model_price_caps ?? [];
    try {
      const updated = await updateAccountLimits(account.id, {
        req_per_day: Number.isFinite(req) ? req : null,
        tokens_per_day: Number.isFinite(tokens) ? tokens : null,
        model_price_caps: caps,
      });
      setData((prev) =>
        prev
          ? {
              ...prev,
              accounts: prev.accounts.map((a) => (a.id === updated.id ? updated : a)),
            }
          : prev
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update limits");
    } finally {
      setUpdatingAccount(null);
    }
  };

  const recentAlerts = data?.alerts.slice(0, 6) ?? [];

  const handleCreatePolicy = async () => {
    if (!policyForm.name.trim() || !policyForm.pattern.trim()) return;
    setUpdatingPolicy("new");
    try {
      const saved = await upsertPolicy(policyForm);
      setData((prev) =>
        prev
          ? { ...prev, policies: [saved, ...prev.policies] }
          : prev
      );
      setPolicyForm({
        name: "",
        description: "",
        match_type: "contains_any",
        pattern: "",
        action: "flag",
        applies_to: "user",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save policy");
    } finally {
      setUpdatingPolicy(null);
    }
  };

  const handleSaveModel = async () => {
    if (!newModel.id.trim() || !newModel.provider.trim()) return;
    try {
      const saved = await upsertModel(newModel);
      setCatalog((prev) => {
        const existing = prev.find((m) => m.id === saved.id);
        if (existing) {
          return prev.map((m) => (m.id === saved.id ? saved : m));
        }
        return [saved, ...prev];
      });
      setNewModel({
        id: "",
        provider: "openai",
        prompt_price_per_1k: 0,
        completion_price_per_1k: 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save model");
    }
  };

  const handleAddAliasTarget = () => {
    if (!aliasForm.alias.trim()) return;
    const last = aliasForm.targets.at(-1);
    setAliasForm((prev) => ({
      ...prev,
      targets: [...prev.targets, { model: last?.model ?? "", weight: 100 }],
    }));
  };

  const handleSaveAlias = async () => {
    if (!aliasForm.alias.trim() || aliasForm.targets.length === 0) return;
    try {
      await setAlias(aliasForm.alias, aliasForm.targets);
      setAliasForm({ alias: "", targets: [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save alias");
    }
  };

  const handleSaveFallbacks = async (modelId: string, chain: string[]) => {
    try {
      await setFallbacks(modelId, chain);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save fallbacks");
    }
  };

  const handleTogglePolicy = async (policy: Policy) => {
    setUpdatingPolicy(policy.id);
    try {
      const saved = await upsertPolicy({ ...policy, enabled: !policy.enabled });
      setData((prev) =>
        prev
          ? {
              ...prev,
              policies: prev.policies.map((p) => (p.id === saved.id ? saved : p)),
            }
          : prev
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update policy");
    } finally {
      setUpdatingPolicy(null);
    }
  };

  const handleTestPolicy = async () => {
    if (!policyTest.policyId || !policyTest.text.trim()) return;
    setUpdatingPolicy(policyTest.policyId);
    try {
      const res = await testPolicy(policyTest.policyId, policyTest.text);
      const outcome = res.matched
        ? `${res.action ?? "flag"} ${res.reason ? `(${res.reason})` : ""} ${res.redacted ? "-> " + res.redacted : ""}`
        : "no match";
      setPolicyTest((prev) => ({ ...prev, result: outcome }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to test policy");
    } finally {
      setUpdatingPolicy(null);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
              Live Control Room
            </p>
            <h1 className="text-3xl font-semibold text-white">Trust & Access Dashboard</h1>
            <p className="mt-1 text-sm text-slate-300">
              Monitor requests, flag UI misuse, and manage who can touch which models.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/chat"
              className="rounded-full border border-white/15 bg-white/5 px-3 py-2 text-sm text-white transition hover:border-white/40 hover:bg-white/10"
            >
              Back to chat
            </Link>
            <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-100 shadow-inner shadow-emerald-500/20">
              {loading ? "Syncing..." : "Live"}
            </div>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title="Conversations"
              value={data?.totals.conversations ?? "-"}
              accent={accent.cyan}
              sub="tracked"
            />
            <MetricCard
              title="Requests"
              value={data?.totals.messages ?? "-"}
              accent={accent.amber}
              sub="stored"
            />
            <MetricCard
              title="Accounts"
              value={data?.totals.users ?? "-"}
              accent={accent.violet}
              sub="with activity"
            />
            <MetricCard
              title="Alerts"
              value={data?.totals.flagged ?? "-"}
              accent={accent.rose}
              sub="UI issues"
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg shadow-emerald-500/5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Recent requests</h2>
              <span className="text-xs text-slate-400">auto-refreshes every 5s</span>
            </div>
            <div className="mt-3 space-y-3">
              {data?.recent_requests.slice(0, 12).map((req) => (
                <div
                  key={req.id}
                  className={clsx(
                    "rounded-xl border px-4 py-3 backdrop-blur transition",
                    req.alert
                      ? "border-rose-400/40 bg-rose-500/10 shadow-inner shadow-rose-500/20"
                      : "border-white/10 bg-white/5 hover:border-white/20"
                  )}
                >
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-400">
                    <span className="rounded-full bg-white/10 px-2 py-1 text-white">
                      {req.role}
                    </span>
                    <span className="rounded-full bg-white/5 px-2 py-1 text-slate-300">
                      {req.model || "unknown"}
                    </span>
                    {req.user_id && (
                      <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-emerald-100">
                        {req.user_id}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-slate-500">
                      {new Date(req.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-100">{req.content_preview}</p>
                  {req.alert && (
                    <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-50">
                      ! {req.alert}
                    </div>
                  )}
                </div>
              ))}
              {!data && loading && (
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">
                  Loading activity...
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-800/60 via-slate-900 to-black px-4 py-4 shadow-lg shadow-cyan-500/5">
            <h2 className="text-lg font-semibold text-white">Alerts</h2>
            <p className="text-sm text-slate-400">UI misuse or risky prompts.</p>
            <div className="mt-3 space-y-3">
              {recentAlerts.length === 0 && (
                <p className="text-sm text-slate-400">No alerts in the last few requests.</p>
              )}
              {recentAlerts.map((alert) => (
                <div
                  key={alert.message_id}
                  className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-3 text-sm text-rose-50 shadow-inner shadow-rose-500/20"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-[0.18em] text-rose-200">
                      {alert.reason}
                    </span>
                    <span className="text-[10px] text-rose-100/80">
                      {new Date(alert.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="mt-2 text-slate-50">{alert.preview}</p>
                  {alert.user_id && (
                    <p className="mt-1 text-[11px] text-rose-100/70">user: {alert.user_id}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Account access</h2>
              <span className="text-xs text-slate-400">remove or add model access</span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {data?.accounts.map((acct) => (
                <div
                  key={acct.id}
                  className="rounded-xl border border-white/10 bg-black/40 p-3 shadow-inner shadow-emerald-500/10"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{acct.display_name}</p>
                      <p className="text-xs text-slate-400">{acct.email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(acct)}
                      className={clsx(
                        "rounded-full px-3 py-1 text-xs font-semibold transition",
                        acct.status === "active"
                          ? "border border-emerald-400/40 bg-emerald-400/10 text-emerald-100 hover:border-emerald-300/60"
                          : "border border-amber-400/40 bg-amber-400/10 text-amber-100 hover:border-amber-300/60"
                      )}
                      disabled={updatingAccount === acct.id}
                    >
                      {acct.status === "active" ? "Suspend" : "Activate"}
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {acct.allowed_models.map((model) => (
                      <span
                        key={model}
                        className="group inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-slate-100"
                      >
                        {model}
                        <button
                          className="text-rose-200 opacity-60 transition hover:opacity-100"
                          onClick={() => handleRemoveModel(acct, model)}
                          disabled={updatingAccount === acct.id}
                          aria-label={`Remove ${model}`}
                        >
                          x
                        </button>
                      </span>
                    ))}
                    {acct.allowed_models.length === 0 && (
                      <span className="text-xs text-slate-400">No model access</span>
                    )}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <input
                      className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/40 focus:outline-none"
                      placeholder="Add model (e.g. gpt-4.1)"
                      value={drafts[acct.id] ?? ""}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [acct.id]: e.target.value }))
                      }
                    />
                    <button
                      onClick={() => handleAddModel(acct)}
                      disabled={updatingAccount === acct.id}
                      className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:border-white/40 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </div>
              ))}
              {!data && loading && (
                <div className="rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-slate-400">
                  Loading accounts...
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
            <h2 className="text-lg font-semibold text-white">Model usage</h2>
            <p className="text-sm text-slate-400">volume by provider & model</p>
            <div className="mt-3 space-y-3">
              {data?.models.map((model) => (
                <div key={`${model.provider}-${model.model}`}>
                  <div className="flex items-center justify-between text-sm text-slate-200">
                    <span className="font-semibold">{model.model}</span>
                    <span className="text-xs text-slate-400">{model.provider}</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400/70 to-cyan-400/70"
                      style={{
                        width: providerTotal
                          ? `${Math.min(100, Math.round((model.count / providerTotal) * 100))}%`
                          : "5%",
                      }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{model.count} calls</p>
                </div>
              ))}
              {!data && loading && (
                <p className="text-sm text-slate-400">Crunching numbers...</p>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Guardrails & limits</h2>
              <span className="text-xs text-slate-400">per account</span>
            </div>
            <div className="mt-3 space-y-3">
              {data?.accounts.map((acct) => {
                const limitsDraft = limitDrafts[acct.id] ?? { caps: acct.model_price_caps ?? [] };
                return (
                  <div
                    key={acct.id}
                    className="rounded-xl border border-white/10 bg-black/40 p-3 shadow-inner shadow-emerald-500/10"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">{acct.display_name}</p>
                        <p className="text-xs text-slate-400">{acct.email}</p>
                      </div>
                      <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        {acct.status}
                      </span>
                    </div>
                    <label className="mt-2 block text-[11px] uppercase tracking-[0.18em] text-slate-400">
                      Guardrail prompt
                    </label>
                    <textarea
                      className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/40 focus:outline-none"
                      rows={2}
                      value={guardrailDrafts[acct.id] ?? acct.guardrail_prompt ?? ""}
                      onChange={(e) =>
                        setGuardrailDrafts((prev) => ({ ...prev, [acct.id]: e.target.value }))
                      }
                    />
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-200">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                          Req/day
                        </p>
                        <input
                          className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/40 focus:outline-none"
                          value={limitsDraft.req ?? (acct.req_per_day ?? "").toString()}
                          onChange={(e) =>
                            setLimitDrafts((prev) => ({
                              ...prev,
                              [acct.id]: { ...(prev[acct.id] ?? { caps: acct.model_price_caps ?? [] }), req: e.target.value },
                            }))
                          }
                          placeholder="e.g. 500"
                        />
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                          Tokens/day
                        </p>
                        <input
                          className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/40 focus:outline-none"
                          value={limitsDraft.tokens ?? (acct.tokens_per_day ?? "").toString()}
                          onChange={(e) =>
                            setLimitDrafts((prev) => ({
                              ...prev,
                              [acct.id]: { ...(prev[acct.id] ?? { caps: acct.model_price_caps ?? [] }), tokens: e.target.value },
                            }))
                          }
                          placeholder="e.g. 500000"
                        />
                      </div>
                    </div>
                    <div className="mt-2 flex gap-2 text-xs">
                      <input
                        className="flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/40 focus:outline-none"
                        placeholder="model id"
                        value={limitsDraft.capModel ?? ""}
                        onChange={(e) =>
                          setLimitDrafts((prev) => ({
                            ...prev,
                            [acct.id]: { ...(prev[acct.id] ?? { caps: acct.model_price_caps ?? [] }), capModel: e.target.value },
                          }))
                        }
                      />
                      <input
                        className="w-24 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/40 focus:outline-none"
                        placeholder="cents"
                        value={limitsDraft.capCents ?? ""}
                        onChange={(e) =>
                          setLimitDrafts((prev) => ({
                            ...prev,
                            [acct.id]: { ...(prev[acct.id] ?? { caps: acct.model_price_caps ?? [] }), capCents: e.target.value },
                          }))
                        }
                      />
                      <button
                        onClick={() => {
                          if (!limitsDraft.capModel || !limitsDraft.capCents) return;
                          const caps = [
                            ...(limitsDraft.caps ?? acct.model_price_caps ?? []),
                            { model: limitsDraft.capModel, max_cents: Number(limitsDraft.capCents) || 0 },
                          ];
                          setLimitDrafts((prev) => ({
                            ...prev,
                            [acct.id]: { ...limitsDraft, caps, capModel: "", capCents: "" },
                          }));
                        }}
                        className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:border-white/40"
                        type="button"
                      >
                        Add cap
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-200">
                      {(limitsDraft.caps ?? acct.model_price_caps ?? []).map((cap) => (
                        <span
                          key={cap.model + cap.max_cents}
                          className="rounded-full border border-white/10 bg-white/10 px-3 py-1"
                        >
                          {cap.model}: {cap.max_cents}c
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => handleSaveGuardrail(acct)}
                        disabled={updatingAccount === acct.id}
                        className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:border-white/40 disabled:opacity-50"
                      >
                        Save guardrail
                      </button>
                      <button
                        onClick={() => handleSaveLimits(acct)}
                        disabled={updatingAccount === acct.id}
                        className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:border-white/40 disabled:opacity-50"
                      >
                        Save limits
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Router health</h2>
              <span className="text-xs text-slate-400">latency & success</span>
            </div>
            <div className="mt-3 space-y-2">
              {data?.router_health.map((entry) => (
                <div
                  key={entry.model}
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{entry.model}</span>
                    <span className="text-xs text-slate-400">{entry.provider}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-slate-300">
                    <span>
                      {entry.last_ok ? "healthy" : "failing"} ·
                      {entry.last_latency_ms ? ` ${entry.last_latency_ms} ms` : " n/a"}
                    </span>
                    <span>
                      ✓ {entry.successes} / ✕ {entry.failures}
                    </span>
                  </div>
                </div>
              ))}
              {!data && loading && (
                <p className="text-sm text-slate-400">Loading router health...</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Model catalog & aliases</h2>
              <span className="text-xs text-slate-400">runtime edits</span>
            </div>
            <div className="mt-3 space-y-3">
              <div className="rounded-lg border border-white/10 bg-black/40 p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-sm text-white">
                  <input
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/40 focus:outline-none"
                    placeholder="model id"
                    value={newModel.id}
                    onChange={(e) => setNewModel((m) => ({ ...m, id: e.target.value }))}
                  />
                  <select
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white"
                    value={newModel.provider}
                    onChange={(e) => setNewModel((m) => ({ ...m, provider: e.target.value }))}
                  >
                    <option value="openai">openai</option>
                    <option value="anthropic">anthropic</option>
                  </select>
                  <input
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/40 focus:outline-none"
                    placeholder="prompt cents/1k"
                    type="number"
                    value={newModel.prompt_price_per_1k}
                    onChange={(e) =>
                      setNewModel((m) => ({ ...m, prompt_price_per_1k: Number(e.target.value) }))
                    }
                  />
                  <input
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/40 focus:outline-none"
                    placeholder="completion cents/1k"
                    type="number"
                    value={newModel.completion_price_per_1k}
                    onChange={(e) =>
                      setNewModel((m) => ({
                        ...m,
                        completion_price_per_1k: Number(e.target.value),
                      }))
                    }
                  />
                </div>
                <button
                  onClick={handleSaveModel}
                  className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:border-white/40"
                >
                  Save model
                </button>
              </div>

              <div className="rounded-lg border border-white/10 bg-black/40 p-3 space-y-2">
                <input
                  className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/40 focus:outline-none"
                  placeholder="alias (e.g. gpt-latest)"
                  value={aliasForm.alias}
                  onChange={(e) => setAliasForm((prev) => ({ ...prev, alias: e.target.value }))}
                />
                {aliasForm.targets.map((t, idx) => (
                  <div key={idx} className="grid grid-cols-3 gap-2 text-sm">
                    <input
                      className="col-span-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/40 focus:outline-none"
                      placeholder="model id"
                      value={t.model}
                      onChange={(e) =>
                        setAliasForm((prev) => {
                          const next = [...prev.targets];
                          next[idx] = { ...next[idx], model: e.target.value };
                          return { ...prev, targets: next };
                        })
                      }
                    />
                    <input
                      className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/40 focus:outline-none"
                      type="number"
                      placeholder="weight"
                      value={t.weight}
                      onChange={(e) =>
                        setAliasForm((prev) => {
                          const next = [...prev.targets];
                          next[idx] = { ...next[idx], weight: Number(e.target.value) || 0 };
                          return { ...prev, targets: next };
                        })
                      }
                    />
                  </div>
                ))}
                <div className="flex gap-2">
                  <button
                    onClick={handleAddAliasTarget}
                    className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:border-white/40"
                  >
                    Add target
                  </button>
                  <button
                    onClick={handleSaveAlias}
                    className="rounded-lg border border-emerald-400/40 bg-emerald-400/15 px-3 py-2 text-xs font-semibold text-emerald-50 hover:border-emerald-300/60"
                  >
                    Save alias
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-black/40 p-3 space-y-2">
                <p className="text-sm font-semibold text-white">Catalog</p>
                <div className="max-h-56 overflow-auto space-y-2 text-xs text-slate-200">
                  {catalog.map((m) => (
                    <div
                      key={m.id}
                      className="space-y-1 rounded border border-white/10 bg-white/5 px-2 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-semibold">{m.id}</span>{" "}
                          <span className="text-slate-400">{m.provider}</span>
                        </div>
                        <span className="text-[11px] text-slate-400">
                          {m.prompt_price_per_1k + m.completion_price_per_1k}c/1k
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <input
                          className="flex-1 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-white placeholder:text-slate-500 focus:border-white/40 focus:outline-none"
                          placeholder="fallbacks comma separated"
                          value={fallbackDrafts[m.id] ?? ""}
                          onChange={(e) =>
                            setFallbackDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))
                          }
                        />
                        <button
                          className="rounded-lg border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white hover:border-white/40"
                          onClick={() =>
                            handleSaveFallbacks(
                              m.id,
                              (fallbackDrafts[m.id] ?? "")
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean)
                            )
                          }
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Policy rules</h2>
              <span className="text-xs text-slate-400">block/flag/redact before LLM</span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-black/40 p-3 space-y-2">
                <input
                  className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  placeholder="Policy name (e.g. HIPAA PII block)"
                  value={policyForm.name}
                  onChange={(e) => setPolicyForm((p) => ({ ...p, name: e.target.value }))}
                />
                <textarea
                  className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  placeholder="Description"
                  value={policyForm.description}
                  onChange={(e) => setPolicyForm((p) => ({ ...p, description: e.target.value }))}
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white"
                    value={policyForm.match_type}
                    onChange={(e) => setPolicyForm((p) => ({ ...p, match_type: e.target.value }))}
                  >
                    <option value="contains_any">contains any</option>
                    <option value="contains_all">contains all</option>
                    <option value="regex">regex</option>
                  </select>
                  <select
                    className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white"
                    value={policyForm.action}
                    onChange={(e) => setPolicyForm((p) => ({ ...p, action: e.target.value }))}
                  >
                    <option value="flag">flag</option>
                    <option value="redact">redact</option>
                    <option value="block">block</option>
                  </select>
                </div>
                <input
                  className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  placeholder="Pattern (comma separated or regex)"
                  value={policyForm.pattern}
                  onChange={(e) => setPolicyForm((p) => ({ ...p, pattern: e.target.value }))}
                />
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-400">Scope:</label>
                  <select
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white"
                    value={policyForm.applies_to}
                    onChange={(e) => setPolicyForm((p) => ({ ...p, applies_to: e.target.value }))}
                  >
                    <option value="user">user</option>
                    <option value="assistant">assistant</option>
                    <option value="any">any</option>
                  </select>
                  <button
                    onClick={handleCreatePolicy}
                    disabled={updatingPolicy === "new"}
                    className="ml-auto rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:border-white/40 disabled:opacity-50"
                  >
                    Save policy
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/40 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <select
                    className="w-2/5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white"
                    value={policyTest.policyId}
                    onChange={(e) => setPolicyTest((prev) => ({ ...prev, policyId: e.target.value }))}
                  >
                    <option value="">Select policy to test</option>
                    {data?.policies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleTestPolicy}
                    disabled={updatingPolicy === policyTest.policyId}
                    className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:border-white/40 disabled:opacity-50"
                  >
                    Run test
                  </button>
                </div>
                <textarea
                  className="h-24 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  placeholder="Sample request to test against the selected policy"
                  value={policyTest.text}
                  onChange={(e) => setPolicyTest((prev) => ({ ...prev, text: e.target.value }))}
                />
                {policyTest.result && (
                  <p className="text-sm text-slate-200">Result: {policyTest.result}</p>
                )}
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {data?.policies.map((policy) => (
                <div
                  key={policy.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-semibold text-white">{policy.name}</p>
                    <p className="text-xs text-slate-400">{policy.description || "No description"}</p>
                    <p className="text-xs text-slate-500">
                      {policy.match_type} - {policy.pattern} - {policy.action}
                    </p>
                  </div>
                  <span
                    className={clsx(
                      "ml-auto rounded-full px-3 py-1 text-xs font-semibold",
                      policy.enabled
                        ? "border border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
                        : "border border-slate-500/40 bg-slate-700/20 text-slate-200"
                    )}
                  >
                    {policy.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <button
                    onClick={() => handleTogglePolicy(policy)}
                    disabled={updatingPolicy === policy.id}
                    className="rounded-lg border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:border-white/40 disabled:opacity-50"
                  >
                    {policy.enabled ? "Disable" : "Enable"}
                  </button>
                </div>
              ))}
              {!data && loading && (
                <p className="text-sm text-slate-400">Loading policies...</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
            <h2 className="text-lg font-semibold text-white">Recent policy hits</h2>
            <p className="text-sm text-slate-400">latest flags/blocks</p>
            <div className="mt-3 space-y-2">
              {data?.policy_hits.slice(0, 8).map((hit) => (
                <div
                  key={hit.id}
                  className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-50"
                >
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.15em]">
                    <span>{hit.policy_name}</span>
                    <span>{hit.action}</span>
                  </div>
                  <p className="text-[11px] text-amber-100/80">
                    {new Date(hit.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
              {data && data.policy_hits.length === 0 && (
                <p className="text-sm text-slate-400">No policy hits yet.</p>
              )}
              {!data && loading && (
                <p className="text-sm text-slate-400">Loading hits...</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

type MetricProps = {
  title: string;
  value: number | string;
  sub: string;
  accent: string;
};

function MetricCard({ title, value, sub, accent }: MetricProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg shadow-cyan-500/5">
      <div className={clsx("absolute inset-0 bg-gradient-to-br opacity-30 blur-3xl", accent)} />
      <div className="relative flex flex-col gap-1">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-400">{title}</p>
        <p className="text-3xl font-semibold text-white">{value}</p>
        <p className="text-xs text-slate-400">{sub}</p>
      </div>
    </div>
  );
}
