"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

type Props = {
  children: React.ReactNode;
};

const navItems = [
  { href: "/chat", label: "Chat", icon: "✉️" },
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
];

export function AppShell({ children }: Props) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-black text-slate-50">
       <main className="h-screen flex flex-col">{children}</main>
    </div>
  );
}
