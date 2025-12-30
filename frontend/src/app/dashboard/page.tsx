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
  const [activeTab, setActiveTab] = useState("overview");
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [showModelModal, setShowModelModal] = useState(false);
  const [showAliasModal, setShowAliasModal] = useState(false);

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

  const tabs = [
    { id: "overview", label: "Overview", icon: "📊" },
    { id: "activity", label: "Activity", icon: "⚡" },
    { id: "access", label: "Access Control", icon: "🔒" },
    { id: "models", label: "Models", icon: "🤖" },
    { id: "policies", label: "Policies", icon: "🛡️" },
  ];

  return (
    <AppShell>
      <div className="flex h-full bg-black">
        {/* Sidebar */}
        <aside className="w-64 flex-shrink-0 border-r border-white/5 bg-white/5 pt-6 hidden md:block">
          <div className="px-6 mb-8">
            <h2 className="text-lg font-bold text-white tracking-tight">Dashboard</h2>
            <p className="text-xs text-slate-400">Control Center</p>
          </div>
          <nav className="space-y-1 px-3">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                  activeTab === tab.id
                    ? "bg-white/10 text-white shadow-inner shadow-white/5"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                )}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Mobile Tab Bar (optional, for small screens) */}
        <div className="md:hidden flex overflow-x-auto border-b border-white/5 bg-white/5 p-2 gap-2">
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={clsx(
                        "whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition",
                        activeTab === tab.id ? "bg-white/10 text-white" : "text-slate-400"
                    )}
                >
                    {tab.label}
                </button>
            ))}
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex w-full flex-col gap-4 px-4 py-4 md:px-6">
            <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-4">
              <div>
                <h1 className="text-2xl font-semibold text-white">{tabs.find(t => t.id === activeTab)?.label}</h1>
                <p className="mt-1 text-sm text-slate-400">
                  {activeTab === 'overview' && "System at a glance."}
                  {activeTab === 'activity' && "Monitor real-time requests and alerts."}
                  {activeTab === 'access' && "Manage accounts, guardrails, and limits."}
                  {activeTab === 'models' && "Configure model catalog, aliases, and routing."}
                  {activeTab === 'policies' && "Define and test safety policies."}
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

            {activeTab === "overview" && (
              <div className="space-y-8">
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
                
                {/* Router Health Summary in Overview */}
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-white">Router Status</h2>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                         {data?.router_health.map((entry) => {
                             const isIdle = entry.successes === 0 && entry.failures === 0;
                             return (
                                 <div key={entry.model} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-300">
                                     <span className={clsx(
                                         "h-2 w-2 rounded-full",
                                         isIdle ? "bg-slate-500" : (entry.last_ok ? "bg-emerald-400" : "bg-rose-400")
                                     )} />
                                     <span className="font-semibold text-white">{entry.model}</span>
                                     <span className="ml-auto opacity-70">
                                         {entry.last_latency_ms ? `${entry.last_latency_ms}ms` : (isIdle ? "idle" : "n/a")}
                                     </span>
                                 </div>
                             );
                         })}
                         {(!data || data.router_health.length === 0) && (
                             <p className="text-sm text-slate-400">Loading or no active routes...</p>
                         )}
                    </div>
                </div>
              </div>
            )}

            {activeTab === "activity" && (
              <section className="flex flex-col gap-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg shadow-emerald-500/5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-white">Recent requests</h2>
                    <span className="text-xs text-slate-400">auto-refreshes every 5s</span>
                  </div>
                  
                  <div className="overflow-x-auto rounded-xl border border-white/5 bg-black/20">
                    <table className="w-full text-left text-sm text-slate-300">
                      <thead className="bg-white/5 text-xs uppercase text-slate-400">
                        <tr>
                          <th className="px-4 py-3 font-medium">Status</th>
                          <th className="px-4 py-3 font-medium">Time</th>
                          <th className="px-4 py-3 font-medium">User</th>
                          <th className="px-4 py-3 font-medium">Model</th>
                          <th className="px-4 py-3 font-medium">Role</th>
                          <th className="px-4 py-3 font-medium">Preview</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {data?.recent_requests.slice(0, 15).map((req) => (
                          <tr 
                            key={req.id} 
                            className={clsx(
                              "transition hover:bg-white/5",
                              req.alert ? "bg-rose-500/5 hover:bg-rose-500/10" : ""
                            )}
                          >
                            <td className="px-4 py-3">
                              {req.alert ? (
                                <span className="inline-flex h-2 w-2 rounded-full bg-rose-500" title={req.alert} />
                              ) : (
                                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                              )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap font-mono text-xs opacity-70">
                              {new Date(req.created_at).toLocaleTimeString()}
                            </td>
                            <td className="px-4 py-3">
                              {req.user_id ? (
                                <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-white">
                                  {req.user_id}
                                </span>
                              ) : (
                                <span className="text-xs opacity-50">-</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-xs">{req.model || "unknown"}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={clsx(
                                "rounded px-1.5 py-0.5 text-[10px] uppercase font-semibold",
                                req.role === "user" ? "bg-indigo-500/20 text-indigo-200" : "bg-cyan-500/20 text-cyan-200"
                              )}>
                                {req.role}
                              </span>
                            </td>
                            <td className="px-4 py-3 max-w-xs truncate opacity-80" title={req.content_preview}>
                              {req.content_preview}
                            </td>
                          </tr>
                        ))}
                        {!data && loading && (
                          <tr>
                            <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                              Loading activity...
                            </td>
                          </tr>
                        )}
                        {data?.recent_requests.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                              No recent requests found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

              </section>
            )}

            {activeTab === "access" && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg shadow-emerald-500/5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-white">Access Control</h2>
                    <span className="text-xs text-slate-400">Manage accounts, models, and safety settings</span>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-white/5 bg-black/20">
                    <table className="w-full text-left text-sm text-slate-300">
                      <thead className="bg-white/5 text-xs uppercase text-slate-400">
                        <tr>
                          <th className="px-6 py-3 font-medium w-1/3">User</th>
                          <th className="px-6 py-3 font-medium w-32">Status</th>
                          <th className="px-6 py-3 font-medium">Access Summary</th>
                          <th className="px-6 py-3 font-medium w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {data?.accounts.map((acct) => {
                           const isExpanded = expandedAccount === acct.id;
                           const limitsDraft = limitDrafts[acct.id] ?? { caps: acct.model_price_caps ?? [] };
                           return (
                            <>
                              <tr 
                                key={acct.id} 
                                className={clsx(
                                  "group transition hover:bg-white/5 cursor-pointer",
                                  isExpanded ? "bg-white/5" : ""
                                )}
                                onClick={() => setExpandedAccount(isExpanded ? null : acct.id)}
                              >
                                <td className="px-6 py-4">
                                  <div className="flex flex-col">
                                    <span className="font-semibold text-white">{acct.display_name}</span>
                                    <span className="text-xs text-slate-500">{acct.email}</span>
                                  </div>
                                </td>
                                <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleStatus(acct)}
                                    className={clsx(
                                      "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition border",
                                      acct.status === "active"
                                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                                        : "border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                                    )}
                                    disabled={updatingAccount === acct.id}
                                  >
                                    {acct.status}
                                  </button>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="text-xs text-slate-400">
                                    {acct.allowed_models.length > 0 ? (
                                      <span className="text-slate-300">{acct.allowed_models.length} models allowed</span>
                                    ) : (
                                      <span className="italic opacity-50">No access</span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <svg 
                                    className={clsx("h-5 w-5 text-slate-500 transition-transform", isExpanded ? "rotate-180" : "")} 
                                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr className="bg-white/[0.02]">
                                  <td colSpan={4} className="px-6 py-6">
                                    <div className="grid gap-6 lg:grid-cols-2">
                                      {/* Models Section */}
                                      <div className="space-y-3">
                                        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Allowed Models</h3>
                                        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                                          <div className="flex flex-wrap gap-2 mb-3">
                                            {acct.allowed_models.map((model) => (
                                              <span
                                                key={model}
                                                className="inline-flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-xs text-slate-200 border border-white/5"
                                              >
                                                {model}
                                                <button
                                                  className="text-slate-400 hover:text-rose-400 ml-1"
                                                  onClick={() => handleRemoveModel(acct, model)}
                                                  disabled={updatingAccount === acct.id}
                                                >
                                                  ×
                                                </button>
                                              </span>
                                            ))}
                                            {acct.allowed_models.length === 0 && (
                                              <span className="text-xs text-slate-500 italic py-1">No allowed models</span>
                                            )}
                                          </div>
                                          <div className="flex gap-2">
                                            <select
                                              className="h-8 w-full rounded border border-white/10 bg-black/40 px-2 text-xs text-white focus:border-white/30 focus:outline-none"
                                              value={drafts[acct.id] ?? ""}
                                              onChange={(e) =>
                                                setDrafts((prev) => ({ ...prev, [acct.id]: e.target.value }))
                                              }
                                            >
                                              <option value="" className="bg-zinc-900 text-slate-400">Select model...</option>
                                              {catalog.map((m) => (
                                                <option key={m.id} value={m.id} className="bg-zinc-900 text-white">
                                                  {m.id}
                                                </option>
                                              ))}
                                            </select>
                                            <button
                                              onClick={() => handleAddModel(acct)}
                                              disabled={!drafts[acct.id] || updatingAccount === acct.id}
                                              className="h-8 rounded border border-white/10 bg-white/5 px-3 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-50"
                                            >
                                              Add
                                            </button>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Limits Section */}
                                      <div className="space-y-3">
                                        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Usage Limits</h3>
                                        <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
                                          <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                              <label className="text-[10px] text-slate-400">Requests / Day</label>
                                              <input
                                                className="h-8 w-full rounded border border-white/10 bg-black/40 px-2 text-xs text-white placeholder:text-slate-600 focus:border-white/30 focus:outline-none"
                                                value={limitsDraft.req ?? (acct.req_per_day ?? "").toString()}
                                                onChange={(e) =>
                                                  setLimitDrafts((prev) => ({
                                                    ...prev,
                                                    [acct.id]: { ...(prev[acct.id] ?? { caps: acct.model_price_caps ?? [] }), req: e.target.value },
                                                  }))
                                                }
                                                placeholder="No limit"
                                              />
                                            </div>
                                            <div className="space-y-1">
                                              <label className="text-[10px] text-slate-400">Tokens / Day</label>
                                              <input
                                                className="h-8 w-full rounded border border-white/10 bg-black/40 px-2 text-xs text-white placeholder:text-slate-600 focus:border-white/30 focus:outline-none"
                                                value={limitsDraft.tokens ?? (acct.tokens_per_day ?? "").toString()}
                                                onChange={(e) =>
                                                  setLimitDrafts((prev) => ({
                                                    ...prev,
                                                    [acct.id]: { ...(prev[acct.id] ?? { caps: acct.model_price_caps ?? [] }), tokens: e.target.value },
                                                  }))
                                                }
                                                placeholder="No limit"
                                              />
                                            </div>
                                          </div>
                                          
                                          <button
                                            onClick={() => handleSaveLimits(acct)}
                                            disabled={updatingAccount === acct.id}
                                            className="w-full h-8 rounded border border-white/10 bg-white/5 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white"
                                          >
                                            Save Limits
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                           );
                        })}
                        {!data && loading && (
                          <tr><td colSpan={4} className="p-8 text-center text-slate-500">Loading accounts...</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "models" && (
              <div className="flex flex-col gap-6 h-full">
                {/* Header Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                   <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col justify-between">
                      <span className="text-xs text-slate-400 uppercase tracking-wider">Total Calls</span>
                      <span className="text-2xl font-bold text-white">{data?.totals.messages ?? 0}</span>
                   </div>
                   <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col justify-between">
                      <span className="text-xs text-slate-400 uppercase tracking-wider">Active Models</span>
                      <span className="text-2xl font-bold text-emerald-400">{catalog.length}</span>
                   </div>
                   <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col justify-between">
                      <span className="text-xs text-slate-400 uppercase tracking-wider">Avg Latency</span>
                      <span className="text-2xl font-bold text-cyan-400">
                        {Math.round(
                          (data?.router_health.reduce((acc, h) => acc + (h.last_latency_ms || 0), 0) || 0) / 
                          (data?.router_health.filter(h => h.last_latency_ms).length || 1)
                        )}ms
                      </span>
                   </div>
                   <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col justify-between">
                      <span className="text-xs text-slate-400 uppercase tracking-wider">Success Rate</span>
                      <span className="text-2xl font-bold text-white">
                        {(() => {
                           const s = data?.router_health.reduce((acc, h) => acc + h.successes, 0) || 0;
                           const f = data?.router_health.reduce((acc, h) => acc + h.failures, 0) || 0;
                           if (s + f === 0) return "100%";
                           return Math.round((s / (s + f)) * 100) + "%";
                        })()}
                      </span>
                   </div>
                </div>

                <div className="flex flex-col gap-6 flex-1 min-h-0">
                  {/* Main Catalog Table */}
                  <div className="flex-1 rounded-2xl border border-white/10 bg-white/5 flex flex-col min-h-0">
                    <div className="p-4 border-b border-white/5 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <h2 className="text-lg font-semibold text-white">Model Catalog</h2>
                        <div className="flex gap-2">
                           <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 text-xs font-medium border border-emerald-500/20">
                              {data?.router_health.filter(h => h.last_ok).length} Healthy
                           </span>
                           <span className="px-2 py-1 rounded bg-rose-500/10 text-rose-400 text-xs font-medium border border-rose-500/20">
                              {data?.router_health.filter(h => !h.last_ok && (h.successes > 0 || h.failures > 0)).length} Failing
                           </span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowAliasModal(true)}
                          className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-xs font-medium text-white hover:bg-white/10 transition"
                        >
                          Configure Alias
                        </button>
                        <button
                          onClick={() => setShowModelModal(true)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition"
                        >
                          + Add Model
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex-1 overflow-auto">
                      <table className="w-full text-left text-sm text-slate-300">
                        <thead className="bg-black/20 text-xs uppercase text-slate-400 sticky top-0 backdrop-blur-sm z-10">
                          <tr>
                            <th className="px-6 py-3 font-medium">Model</th>
                            <th className="px-6 py-3 font-medium text-center">Status</th>
                            <th className="px-6 py-3 font-medium text-right">Usage</th>
                            <th className="px-6 py-3 font-medium text-right">Pricing (1k)</th>
                            <th className="px-6 py-3 font-medium">Fallbacks</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {catalog.map((m) => {
                             // Join data
                             const health = data?.router_health.find(h => h.model === m.id);
                             const usage = data?.models.find(u => u.model === m.id);
                             const isIdle = !health || (health.successes === 0 && health.failures === 0);
                             const isHealthy = health?.last_ok;
                             
                             return (
                              <tr key={m.id} className="hover:bg-white/5 transition group">
                                <td className="px-6 py-4">
                                  <div className="flex flex-col">
                                    <span className="font-semibold text-white">{m.id}</span>
                                    <span className="text-xs text-slate-500">{m.provider}</span>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-white/5 bg-white/5 text-[10px] font-medium">
                                    <span className={clsx("h-1.5 w-1.5 rounded-full", 
                                      isIdle ? "bg-slate-500" : (isHealthy ? "bg-emerald-400" : "bg-rose-500")
                                    )} />
                                    <span className={isIdle ? "text-slate-400" : (isHealthy ? "text-emerald-100" : "text-rose-100")}>
                                      {isIdle ? "Idle" : (isHealthy ? "Healthy" : "Issues")}
                                    </span>
                                  </div>
                                  {!isIdle && health && (
                                     <div className="text-[10px] text-slate-500 mt-1">
                                        {health.last_latency_ms}ms avg
                                     </div>
                                  )}
                                </td>
                                <td className="px-6 py-4 text-right">
                                   <div className="font-mono text-white">{usage?.count ?? 0}</div>
                                   <div className="text-[10px] text-slate-500">calls</div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <div className="font-mono text-xs">
                                    <span className="text-slate-300">{m.prompt_price_per_1k}¢</span>
                                    <span className="text-slate-600 mx-1">/</span>
                                    <span className="text-slate-300">{m.completion_price_per_1k}¢</span>
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                   <div className="flex items-center gap-2">
                                     <input
                                       className="w-full max-w-[200px] rounded border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:border-white/30 focus:outline-none transition group-hover:bg-black/60"
                                       placeholder="fallbacks..."
                                       value={fallbackDrafts[m.id] ?? ""}
                                       onChange={(e) =>
                                         setFallbackDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))
                                       }
                                     />
                                     <button
                                        className="h-7 w-7 flex items-center justify-center rounded border border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
                                        title="Save fallbacks"
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
                                        ✓
                                      </button>
                                   </div>
                                </td>
                              </tr>
                             );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Modals */}
                {showModelModal && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0A0A0A] shadow-2xl">
                      <div className="p-4 border-b border-white/5 flex items-center justify-between">
                        <h3 className="font-semibold text-white">Add New Model</h3>
                        <button onClick={() => setShowModelModal(false)} className="text-slate-400 hover:text-white">✕</button>
                      </div>
                      <div className="p-4 space-y-4">
                         <div>
                            <label className="text-[10px] uppercase text-slate-500 font-semibold tracking-wider ml-1">ID & Provider</label>
                            <div className="flex gap-2 mt-1">
                              <input
                                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                                placeholder="e.g. gpt-5"
                                value={newModel.id}
                                onChange={(e) => setNewModel((m) => ({ ...m, id: e.target.value }))}
                              />
                              <select
                                className="w-[100px] rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                                value={newModel.provider}
                                onChange={(e) => setNewModel((m) => ({ ...m, provider: e.target.value }))}
                              >
                                <option value="openai">openai</option>
                                <option value="anthropic">anthropic</option>
                              </select>
                            </div>
                         </div>

                         <div className="grid grid-cols-2 gap-3">
                            <div>
                               <label className="text-[10px] uppercase text-slate-500 font-semibold tracking-wider ml-1">Prompt ¢</label>
                               <input
                                  type="number"
                                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                                  placeholder="0.00"
                                  value={newModel.prompt_price_per_1k}
                                  onChange={(e) => setNewModel((m) => ({ ...m, prompt_price_per_1k: Number(e.target.value) }))}
                               />
                            </div>
                            <div>
                               <label className="text-[10px] uppercase text-slate-500 font-semibold tracking-wider ml-1">Comp. ¢</label>
                               <input
                                  type="number"
                                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                                  placeholder="0.00"
                                  value={newModel.completion_price_per_1k}
                                  onChange={(e) => setNewModel((m) => ({ ...m, completion_price_per_1k: Number(e.target.value) }))}
                               />
                            </div>
                         </div>
                         
                         <button
                           onClick={() => {
                             handleSaveModel();
                             setShowModelModal(false);
                           }}
                           className="w-full py-2.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-sm font-semibold transition border border-emerald-500/20"
                         >
                           Register Model
                         </button>
                      </div>
                    </div>
                  </div>
                )}

                {showAliasModal && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0A0A0A] shadow-2xl">
                      <div className="p-4 border-b border-white/5 flex items-center justify-between">
                        <h3 className="font-semibold text-white">Configure Alias</h3>
                        <button onClick={() => setShowAliasModal(false)} className="text-slate-400 hover:text-white">✕</button>
                      </div>
                      <div className="p-4 space-y-4">
                         <div>
                            <label className="text-[10px] uppercase text-slate-500 font-semibold tracking-wider ml-1">Alias Name</label>
                            <input
                              className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                              placeholder="e.g. gpt-production"
                              value={aliasForm.alias}
                              onChange={(e) => setAliasForm((prev) => ({ ...prev, alias: e.target.value }))}
                            />
                         </div>
                         
                         <div className="space-y-2">
                            <label className="text-[10px] uppercase text-slate-500 font-semibold tracking-wider ml-1">Targets</label>
                            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                                {aliasForm.targets.map((t, idx) => (
                                  <div key={idx} className="flex gap-2">
                                    <input
                                      className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-white/30 focus:outline-none"
                                      placeholder="target model"
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
                                      className="w-14 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs text-white text-center focus:border-white/30 focus:outline-none"
                                      placeholder="wt"
                                      type="number"
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
                            </div>
                            <div className="flex gap-2 pt-1">
                               <button
                                 onClick={handleAddAliasTarget}
                                 className="flex-1 py-2 rounded-lg border border-dashed border-white/20 text-xs text-slate-400 hover:text-white hover:border-white/40 hover:bg-white/5 transition"
                               >
                                 + Add Target
                               </button>
                               <button
                                 onClick={() => {
                                   handleSaveAlias();
                                   setShowAliasModal(false);
                                 }}
                                 className="flex-1 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 transition"
                               >
                                 Save Alias
                               </button>
                            </div>
                         </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === "policies" && (
                <div className="grid gap-6 lg:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 lg:col-span-2">
                        <div className="flex items-center justify-between">
                          <h2 className="text-lg font-semibold text-white">Policy rules</h2>
                          <span className="text-xs text-slate-400">block/flag/redact before LLM</span>
                        </div>
                        <div className="mt-3 grid gap-3">
                          <div className="rounded-xl border border-white/10 bg-black/40 p-3 space-y-2">
                            <h3 className="text-sm font-semibold text-white">Create Policy</h3>
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
                            <h3 className="text-sm font-semibold text-white">Test Policy</h3>
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
                </div>
            )}
          </div>
        </div>
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
