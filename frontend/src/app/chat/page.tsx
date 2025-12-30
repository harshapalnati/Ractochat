"use client";

import { ChatInterface } from "@/components/chat/ChatInterface";
import { AppShell } from "@/components/layout/AppShell";

export default function ChatPage() {
  return (
    <AppShell>
      <ChatInterface />
    </AppShell>
  );
}
