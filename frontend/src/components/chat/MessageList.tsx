import clsx from "clsx";
import type { ChatMessage } from "@/lib/api";

type Props = {
  messages: (ChatMessage & {
    id: string;
    tokens_input?: number;
    tokens_output?: number;
    cost?: number;
    routing?: {
      selected_model: string;
      provider: string;
      attempts: string[];
      used_fallback: boolean;
    };
  })[];
};

export function MessageList({ messages }: Props) {
  return (
    <div className="flex flex-col gap-4">
      {messages.map((msg) => (
        <article
          key={msg.id}
          className={clsx(
            "rounded-2xl border p-4 shadow-sm backdrop-blur",
            msg.role === "assistant"
              ? "border-emerald-400/20 bg-emerald-400/5"
              : "border-white/10 bg-white/5"
          )}
        >
          <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-slate-300">
            <span
              className={clsx(
                "h-2 w-2 rounded-full",
                msg.role === "assistant" ? "bg-emerald-400" : "bg-sky-400"
              )}
            />
            {msg.role}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
            {msg.content}
          </p>
          {msg.role === "assistant" && (msg.tokens_output || msg.tokens_input || msg.cost) && (
            <div className="mt-2 text-xs text-slate-300">
              {typeof msg.tokens_input === "number" && (
                <span className="mr-3">in: {msg.tokens_input}</span>
              )}
              {typeof msg.tokens_output === "number" && (
                <span className="mr-3">out: {msg.tokens_output}</span>
              )}
              {typeof msg.cost === "number" && (
                <span>cost: ${msg.cost.toFixed(6)}</span>
              )}
              {msg.routing && (
                <span className="ml-3 inline-flex items-center gap-1 rounded-full bg-black/30 px-2 py-1 text-[11px] font-semibold text-emerald-200">
                  {msg.routing.selected_model}
                  {msg.routing.used_fallback && (
                    <span className="text-amber-300">fallback</span>
                  )}
                </span>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
