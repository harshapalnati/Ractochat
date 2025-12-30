"use client";

import { useEffect, useState } from "react";
import type { ChatProvider } from "@/lib/api";
import { listModels, type CatalogEntry } from "@/lib/admin";
import clsx from "clsx";

type Props = {
  provider: ChatProvider;
  model: string;
  onProviderChange: (p: ChatProvider) => void;
  onModelChange: (m: string) => void;
};

const fallbackPresets: {
  provider: ChatProvider;
  model: string;
  label: string;
  note: string;
}[] = [
  {
    provider: "openai",
    model: "gpt-4.1",
    label: "OpenAI · GPT-4.1",
    note: "Balanced general model",
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    label: "OpenAI · GPT-4o-mini",
    note: "Fast and cost efficient",
  },
  {
    provider: "anthropic",
    model: "claude-3.5-sonnet",
    label: "Claude · Sonnet",
    note: "Quality-speed mix",
  },
  {
    provider: "anthropic",
    model: "claude-3-haiku",
    label: "Claude · Haiku",
    note: "Low-latency drafting",
  },
];

export function ModelSelector({
  provider,
  model,
  onProviderChange,
  onModelChange,
}: Props) {
  const [models, setModels] = useState<CatalogEntry[]>([]);

  useEffect(() => {
    listModels()
      .then((res) => setModels(res))
      .catch(() => setModels([]));
  }, []);

  const presets =
    models.length > 0
      ? models.map((m) => ({
          provider: m.provider as ChatProvider,
          model: m.id,
          label: `${m.provider} · ${m.id}`,
          note: `${m.prompt_price_per_1k + m.completion_price_per_1k}c / ~1k`,
        }))
      : fallbackPresets;

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            Model
          </p>
          <p className="text-base font-semibold text-white">{model}</p>
        </div>
      </div>

      <div className="grid gap-3">
        {presets.map((preset) => {
          const active =
            preset.provider === provider && preset.model === model;
          return (
            <button
              type="button"
              key={`${preset.provider}-${preset.model}`}
              onClick={() => {
                onProviderChange(preset.provider);
                onModelChange(preset.model);
              }}
              className={clsx(
                "flex flex-col items-start rounded-xl border px-3 py-3 text-left transition",
                active
                  ? "border-emerald-400/40 bg-emerald-400/10 shadow-inner shadow-emerald-400/20"
                  : "border-white/10 bg-white/5 hover:border-white/30 hover:bg-white/10"
              )}
            >
              <span className="text-sm font-semibold text-white">
                {preset.label}
              </span>
              <span className="text-xs text-slate-300">{preset.note}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-2">
        <label className="block text-xs uppercase tracking-[0.2em] text-slate-400">
          Custom model
        </label>
        <input
          className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/30 focus:outline-none"
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          placeholder="e.g., gpt-4.1, claude-3.5-sonnet-latest"
        />
        <div className="flex gap-2">
          {(["openai", "anthropic"] as ChatProvider[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onProviderChange(p)}
              className={clsx(
                "flex-1 rounded-lg border px-2 py-2 text-xs font-semibold uppercase tracking-[0.15em]",
                p === provider
                  ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-100"
                  : "border-white/10 bg-white/5 text-slate-200 hover:border-white/30"
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
