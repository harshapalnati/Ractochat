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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-black text-slate-50">
      <div className="mx-auto flex max-w-7xl gap-6 px-3 py-6 md:px-6 lg:px-8">
        <aside className="sticky top-6 hidden w-60 shrink-0 rounded-2xl border border-white/10 bg-black/50 p-4 shadow-lg shadow-black/30 backdrop-blur md:block">
          <div className="mb-6">
            <div className="text-xs uppercase tracking-[0.28em] text-slate-500">
              Control
            </div>
            <div className="mt-1 text-lg font-semibold text-white">
              Mono Console
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Switch between chat and admin tools.
            </p>
          </div>
          <nav className="space-y-2">
            {navItems.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    "flex items-center gap-3 rounded-xl border px-3 py-2 text-sm font-semibold transition",
                    active
                      ? "border-slate-100 bg-slate-100 text-slate-900"
                      : "border-white/10 bg-white/5 text-slate-200 hover:border-white/30 hover:bg-white/10"
                  )}
                >
                  <span className="text-base">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="flex-1 space-y-6">{children}</main>
      </div>
    </div>
  );
}
