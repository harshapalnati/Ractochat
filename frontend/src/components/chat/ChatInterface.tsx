"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { streamChat, type ChatMessage, type ChatProvider, API_URL } from "@/lib/api";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ModelSelector } from "./ModelSelector";
import { v4 as uuidv4 } from "uuid";
import clsx from "clsx";

type ConversationMessage = ChatMessage & {
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
};

type Conversation = {
  id: string;
  title: string;
  updatedAt: number;
};

export function ChatInterface() {
  const [provider, setProvider] = useState<ChatProvider>("openai");
  const [model, setModel] = useState("gpt-4.1");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("demo@local");
  const [loginPassword, setLoginPassword] = useState("demo123");
  const [loginStatus, setLoginStatus] = useState<"idle" | "ok" | "error">(
    "idle"
  );
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const storedConversations = localStorage.getItem("conversations");
    const storedActive = localStorage.getItem("conversation_id");
    if (storedConversations) {
      try {
        const parsed = JSON.parse(storedConversations) as Conversation[];
        setConversations(parsed);
      } catch {
        setConversations([]);
      }
    }
    if (storedActive) {
      setConversationId(storedActive);
      loadMessages(storedActive);
    }
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    localStorage.setItem("conversations", JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    if (conversationId) {
      localStorage.setItem("conversation_id", conversationId);
      loadMessages(conversationId);
    }
  }, [conversationId]);

  const currentTitle = useMemo(() => {
    const current = conversations.find((c) => c.id === conversationId);
    if (current && current.title.trim().length > 0) return current.title;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    return lastUser?.content.slice(0, 60) || "New chat";
  }, [conversations, conversationId, messages]);

  const loadMessages = (id: string) => {
    const raw = localStorage.getItem(`messages:${id}`);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ConversationMessage[];
        setMessages(parsed);
        return;
      } catch {
        // ignore
      }
    }
    setMessages([]);
  };

  const persistMessages = (id: string, msgs: ConversationMessage[]) => {
    localStorage.setItem(`messages:${id}`, JSON.stringify(msgs));
  };

  const startNewConversation = () => {
    const id = uuidv4();
    const newConv: Conversation = {
      id,
      title: "New chat",
      updatedAt: Date.now(),
    };
    setConversations((prev) => [newConv, ...prev]);
    setConversationId(id);
    setMessages([]);
    persistMessages(id, []);
  };

  const selectConversation = (id: string) => {
    setConversationId(id);
  };

  const updateConversationTitle = (id: string, candidate: string) => {
    setConversations((prev) =>
      prev
        .map((c) =>
          c.id === id
            ? {
                ...c,
                title:
                  c.title === "New chat"
                    ? candidate.slice(0, 60) || "New chat"
                    : c.title,
                updatedAt: Date.now(),
              }
            : c
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
    );
  };

  const handleSend = async (text: string) => {
    if (!text.trim()) return;
    setError(null);

    let activeId = conversationId;
    if (!activeId) {
      const id = uuidv4();
      activeId = id;
      setConversationId(id);
      const newConv: Conversation = {
        id,
        title: "New chat",
        updatedAt: Date.now(),
      };
      setConversations((prev) => [newConv, ...prev]);
      persistMessages(id, []);
    }

    const trimmed = text.trim();
    const userMessage: ConversationMessage = {
      id: uuidv4(),
      role: "user",
      content: trimmed,
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    persistMessages(activeId, nextMessages);
    updateConversationTitle(activeId, trimmed);
    setIsSending(true);

    try {
      const assistantId = uuidv4();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "" },
      ]);

      let streamingContent = "";
      const meta = await streamChat(
        {
          provider,
          model,
          conversation_id: activeId,
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
        },
        (delta) => {
          streamingContent += delta;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: streamingContent } : m
            )
          );
        }
      );

      const updatedMessages = [
        ...nextMessages,
        {
          id: assistantId,
          role: "assistant",
          content: streamingContent,
          tokens_input: meta.tokens_input,
          tokens_output: meta.tokens_output,
          cost: meta.cost,
          routing: meta.routing,
        },
      ];
      setMessages(updatedMessages);
      persistMessages(activeId, updatedMessages);
      updateConversationTitle(activeId, trimmed);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to send message";
      setError(
        `${message}. Verify NEXT_PUBLIC_API_URL and that the backend is reachable.`
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleLogin = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setLoginStatus("ok");
    } catch {
      setLoginStatus("error");
    }
  };

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-black text-slate-50">
      <aside className="hidden w-[280px] flex-col border-r border-white/10 bg-black/40 p-4 backdrop-blur lg:flex">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">
              Multi-Model Lab
            </p>
            <h1 className="text-lg font-semibold text-white">Chats</h1>
          </div>
          <button
            onClick={startNewConversation}
            className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-100 shadow-inner shadow-emerald-500/20 transition hover:bg-emerald-400/20"
          >
            New
          </button>
        </div>

        <div className="mt-4 space-y-2 overflow-y-auto pr-1">
          {conversations.length === 0 && (
            <p className="text-sm text-slate-400">No conversations yet.</p>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => selectConversation(c.id)}
              className={clsx(
                "w-full rounded-xl border px-3 py-3 text-left transition",
                c.id === conversationId
                  ? "border-emerald-400/50 bg-emerald-400/10 text-white"
                  : "border-white/10 bg-white/5 text-slate-200 hover:border-white/30"
              )}
            >
              <p className="line-clamp-2 text-sm font-semibold">{c.title}</p>
              <p className="mt-1 text-xs text-slate-400">
                {new Date(c.updatedAt).toLocaleString()}
              </p>
            </button>
          ))}
        </div>

        <div className="mt-auto space-y-4">
          <ModelSelector
            provider={provider}
            model={model}
            onProviderChange={setProvider}
            onModelChange={setModel}
          />
          <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Auth (demo stub)
            </p>
            <input
              className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white placeholder:text-slate-500 focus:border-white/30 focus:outline-none"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="email"
            />
            <input
              type="password"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white placeholder:text-slate-500 focus:border-white/30 focus:outline-none"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="password"
            />
            <button
              type="button"
              onClick={handleLogin}
              className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:border-white/40"
            >
              Login
            </button>
            {loginStatus === "ok" && (
              <p className="text-xs text-emerald-300">Signed in (demo)</p>
            )}
            {loginStatus === "error" && (
              <p className="text-xs text-rose-300">Login failed</p>
            )}
          </div>
        </div>
      </aside>

      <main className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">
              {provider === "openai" ? "OpenAI" : "Anthropic"}
            </p>
            <h2 className="text-xl font-semibold text-white">{currentTitle}</h2>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Link
              href="/dashboard"
              className="hidden rounded-full border border-white/15 bg-white/5 px-3 py-2 font-semibold text-white transition hover:border-white/40 hover:bg-white/10 md:inline-flex"
            >
              Admin dashboard
            </Link>
            <span className="rounded-full bg-white/10 px-3 py-1 text-slate-200">
              {model}
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1 text-slate-200">
              {conversationId ? "Persisted" : "New"}
            </span>
          </div>
        </header>

        <section className="flex flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-4 md:p-6">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-300">
                <p className="text-lg font-semibold text-white">
                  Start a conversation
                </p>
                <p className="max-w-md text-sm text-slate-300/90">
                  Your first message will name the chat and create it. Pick a model and send a prompt.
                </p>
                <button
                  onClick={startNewConversation}
                  className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white hover:border-white/40"
                >
                  New chat
                </button>
              </div>
            ) : (
              <MessageList messages={messages} />
            )}
            <div ref={endRef} />
          </div>

          {error && (
            <div className="mx-4 mb-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
              {error}
            </div>
          )}

          <div className="border-t border-white/10 bg-black/40 p-3 md:p-4">
            <MessageInput
              onSend={handleSend}
              disabled={isSending}
              placeholder={`Message ${provider === "openai" ? "OpenAI" : "Claude"}...`}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
