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
  
  // Auth state (simplified for UI)
  const [loginEmail, setLoginEmail] = useState("demo@local");
  const [loginPassword, setLoginPassword] = useState("demo123");
  const [showAuth, setShowAuth] = useState(false);
  const [loginStatus, setLoginStatus] = useState<"idle" | "ok" | "error">("idle");
  
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
    return "New Chat";
  }, [conversations, conversationId]);

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
      setShowAuth(false);
    } catch {
      setLoginStatus("error");
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#111111] text-gray-100">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-white/5 bg-[#000000] px-3 py-4">
        <div className="mb-6 flex items-center justify-between px-2">
          <button
            onClick={startNewConversation}
            className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10"
          >
            <span>+</span> New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2">
           <h3 className="mb-2 px-2 text-xs font-semibold uppercase text-gray-500">Today</h3>
          <div className="space-y-1">
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => selectConversation(c.id)}
                className={clsx(
                  "w-full rounded-md px-3 py-2 text-left text-sm transition",
                  c.id === conversationId
                    ? "bg-white/10 text-white"
                    : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                )}
              >
                <span className="line-clamp-1">{c.title}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-auto border-t border-white/10 px-2 pt-4">
            <Link href="/dashboard" className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300">
                <span>Dashboard</span>
            </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex flex-1 flex-col relative">
        {/* Header */}
        <header className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
               {/* Model Selector placed in header */}
               <div className="scale-90 origin-left">
                  <ModelSelector 
                    provider={provider}
                    model={model}
                    onProviderChange={setProvider}
                    onModelChange={setModel}
                  />
               </div>
            </div>
            
            <div className="relative">
                <button 
                    onClick={() => setShowAuth(!showAuth)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white hover:bg-indigo-500"
                >
                    {loginStatus === 'ok' ? 'D' : 'U'}
                </button>
                {/* Simple Auth Dropdown */}
                {showAuth && (
                    <div className="absolute right-0 top-10 z-20 w-64 rounded-xl border border-white/10 bg-[#1a1a1a] p-4 shadow-xl">
                         <h3 className="mb-3 text-sm font-semibold text-white">Login</h3>
                         <div className="space-y-2">
                             <input
                                className="w-full rounded bg-black/50 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                placeholder="Email"
                                value={loginEmail}
                                onChange={e => setLoginEmail(e.target.value)}
                             />
                             <input
                                type="password"
                                className="w-full rounded bg-black/50 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                placeholder="Password"
                                value={loginPassword}
                                onChange={e => setLoginPassword(e.target.value)}
                             />
                             <button 
                                onClick={handleLogin}
                                className="w-full rounded bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                             >
                                Sign In
                             </button>
                             {loginStatus === "ok" && <p className="text-xs text-green-400">Logged in</p>}
                             {loginStatus === "error" && <p className="text-xs text-red-400">Error</p>}
                         </div>
                    </div>
                )}
            </div>
        </header>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto px-4 pb-32 pt-20">
          <div className="mx-auto max-w-3xl">
             {messages.length === 0 ? (
                 <div className="mt-20 flex flex-col items-center justify-center text-center">
                     <h1 className="text-4xl font-semibold text-white mb-4">Where to?</h1>
                     <p className="text-gray-400 mb-8">Start a conversation with the models.</p>
                     
                     {/* Suggestion cards (visual only) */}
                     <div className="grid grid-cols-2 gap-4 w-full max-w-2xl">
                         {['Write a story', 'Explain quantum physics', 'Debug code', 'Translate text'].map(label => (
                             <button key={label} onClick={() => handleSend(label)} className="text-left p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition">
                                 <span className="text-sm font-medium text-gray-300">{label}</span>
                             </button>
                         ))}
                     </div>
                 </div>
             ) : (
                 <MessageList messages={messages} />
             )}
             <div ref={endRef} />
          </div>
        </div>

        {/* Floating Input Area */}
        <div className="absolute bottom-6 left-0 right-0 px-4">
             <div className="mx-auto max-w-3xl">
                  {error && (
                    <div className="mb-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2 text-sm text-red-200">
                        {error}
                    </div>
                  )}
                  
                  <div className="relative rounded-2xl border border-white/10 bg-[#1a1a1a] p-2 shadow-2xl">
                       <MessageInput
                          onSend={handleSend}
                          disabled={isSending}
                          placeholder="Message..."
                        />
                       {/* Visual icons bar below input */}
                       <div className="mt-2 flex items-center justify-between px-2 pb-1">
                           <div className="flex items-center gap-2">
                               <button className="rounded-md p-1.5 text-gray-400 hover:bg-white/5 hover:text-white" title="Attach">
                                   <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                               </button>
                               <button className="rounded-md p-1.5 text-gray-400 hover:bg-white/5 hover:text-white" title="Search">
                                   <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                               </button>
                           </div>
                           <div className="text-xs text-gray-500">
                               {provider} • {model}
                           </div>
                       </div>
                  </div>
             </div>
        </div>
      </main>
    </div>
  );
}
