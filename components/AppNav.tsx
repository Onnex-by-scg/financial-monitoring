"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PAGES = [
  { href: "/", label: "AR Aging" },
  { href: "/financial", label: "Financial Performance" },
];

/** Switches between the dashboard pages; sits in each page's header. */
export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Dashboard" className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
      {PAGES.map((p) => {
        const on = pathname === p.href;
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={on ? "page" : undefined}
            className={`rounded-md px-3 py-1 text-xs font-semibold transition ${on ? "bg-brand-soft text-brand" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
