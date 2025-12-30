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
}[] = [
  {
    provider: "openai",
    model: "gpt-4.1",
    label: "GPT-4.1",
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    label: "GPT-4o Mini",
  },
  {
    provider: "anthropic",
    model: "claude-3.5-sonnet",
    label: "Claude Sonnet",
  },
  {
    provider: "anthropic",
    model: "claude-3-haiku",
    label: "Claude Haiku",
  },
];

export function ModelSelector({
  provider,
  model,
  onProviderChange,
  onModelChange,
}: Props) {
  const [models, setModels] = useState<CatalogEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    listModels()
      .then((res) => setModels(res))
      .catch(() => setModels([]));
  }, []);

  const items =
    models.length > 0
      ? models.map((m) => ({
          provider: m.provider as ChatProvider,
          model: m.id,
          label: m.id, // Use simple ID for cleaner look
        }))
      : fallbackPresets;

  // Deduplicate items based on model ID
  const uniqueItems = Array.from(new Map(items.map(item => [item.model, item])).values());

  const currentLabel = uniqueItems.find(i => i.model === model)?.label || model;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg bg-[#222] px-3 py-2 text-sm font-medium text-gray-200 hover:bg-[#333] transition"
      >
        <span>{currentLabel}</span>
        <svg
          className={clsx("h-4 w-4 text-gray-400 transition", isOpen && "rotate-180")}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-2 w-56 rounded-xl border border-white/10 bg-[#1a1a1a] p-1 shadow-xl">
             <div className="max-h-64 overflow-y-auto">
                 {uniqueItems.map((item) => (
                    <button
                        key={`${item.provider}-${item.model}`}
                        onClick={() => {
                            onProviderChange(item.provider);
                            onModelChange(item.model);
                            setIsOpen(false);
                        }}
                        className={clsx(
                            "w-full text-left rounded-lg px-3 py-2 text-sm transition",
                            item.model === model 
                                ? "bg-white/10 text-white" 
                                : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                        )}
                    >
                        <span className="block font-medium">{item.label}</span>
                        <span className="block text-[10px] uppercase text-gray-500">{item.provider}</span>
                    </button>
                 ))}
             </div>
             
             {/* Custom Input Option */}
             <div className="border-t border-white/10 pt-1 mt-1">
                 <input 
                    placeholder="Custom model..."
                    className="w-full bg-transparent px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none"
                    value={model}
                    onChange={(e) => onModelChange(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                 />
             </div>
          </div>
        </>
      )}
    </div>
  );
}
