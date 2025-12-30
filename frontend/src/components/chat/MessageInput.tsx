"use client";

import { useState } from "react";

type Props = {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

export function MessageInput({ onSend, disabled, placeholder }: Props) {
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSend(value);
    setValue("");
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 shadow-inner"
    >
      <textarea
        className="min-h-[64px] flex-1 resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/30 focus:outline-none"
        value={value}
        placeholder={placeholder ?? "Type your message..."}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {disabled ? "Sending..." : "Send"}
      </button>
    </form>
  );
}
