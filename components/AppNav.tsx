"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ViewTransition } from "react";

const PAGES = [
  { href: "/", label: "AR Aging" },
  { href: "/financial", label: "Financial Performance" },
];

/**
 * Switches between the dashboard pages; sits in each page's header.
 * Links carry a direction (pages to the right are "forward") so the page content slides the matching way
 * (app/globals.css), and the active highlight glides to the new tab (shared "appnav-pill" view transition).
 */
export function AppNav() {
  const pathname = usePathname();
  const current = PAGES.findIndex((p) => p.href === pathname);
  return (
    <nav aria-label="Dashboard" className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
      {PAGES.map((p, i) => {
        const on = i === current;
        return (
          <Link
            key={p.href}
            href={p.href}
            transitionTypes={on ? undefined : [i > current ? "nav-forward" : "nav-back"]}
            aria-current={on ? "page" : undefined}
            className={`relative rounded-md px-3 py-1 text-xs font-semibold transition-colors ${on ? "text-brand" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}
          >
            {on && (
              <ViewTransition name="appnav-pill" share="appnav-pill">
                <span className="absolute inset-0 rounded-md bg-brand-soft" aria-hidden />
              </ViewTransition>
            )}
            {/* Own view-transition layer above the gliding highlight, so the label is never covered mid-glide. */}
            <span className="relative" style={{ viewTransitionName: `appnav-label-${i}` }}>
              {p.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
