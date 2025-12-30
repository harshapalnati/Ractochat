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
    <div className="flex flex-col space-y-8">
      {messages.map((msg) => (
        <article key={msg.id} className="flex gap-4">
          <div className={clsx(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
              msg.role === "assistant" ? "bg-white text-black" : "bg-white/10 text-white"
          )}>
            {msg.role === "assistant" ? "AI" : "U"}
          </div>
          
          <div className="flex-1 space-y-1 overflow-hidden">
             <div className="flex items-center gap-2">
                 <span className="text-sm font-semibold text-white">
                     {msg.role === "assistant" ? "Assistant" : "You"}
                 </span>
             </div>
             <div className="prose prose-invert max-w-none text-sm leading-relaxed text-gray-300">
                <p className="whitespace-pre-wrap">{msg.content}</p>
             </div>
             
             {msg.role === "assistant" && (msg.tokens_output || msg.routing) && (
                <div className="pt-2 flex items-center gap-3 text-xs text-gray-600">
                    {msg.routing?.selected_model && (
                        <span>{msg.routing.selected_model}</span>
                    )}
                    {(msg.tokens_input || msg.tokens_output) && (
                        <span>{msg.tokens_input ?? 0} in / {msg.tokens_output ?? 0} out</span>
                    )}
                    {msg.cost !== undefined && (
                        <span>${msg.cost.toFixed(5)}</span>
                    )}
                </div>
             )}
          </div>
        </article>
      ))}
    </div>
  );
}
