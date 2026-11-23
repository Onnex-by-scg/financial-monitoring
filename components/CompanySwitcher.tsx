"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

// The dashboard's company picker: one compact button at the start of the header that opens a panel of companies,
// grouped by data source (PEAK, NetSuite), with search once the list gets long. Used by AR Aging and Financial Performance.

export interface SwitcherItem {
  id: string;
  name: string;
  provider: "peak" | "netsuite";
  /** Listed but not selectable, with the reason shown under the name. */
  disabledReason?: string;
}

const SOURCE: Record<SwitcherItem["provider"], string> = { peak: "PEAK", netsuite: "NetSuite" };
const SEARCH_FROM = 7;

/** "THS (Monthly)" -> "TM", "Solar" -> "SO", "Nexter Living" -> "NL". */
function initials(name: string): string {
  const words = name.replace(/[()]/g, " ").split(/\s+/).filter(Boolean);
  const s = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return s.toUpperCase();
}

function Monogram({ name, provider, size = "md" }: { name: string; provider: SwitcherItem["provider"]; size?: "sm" | "md" }) {
  const tone = provider === "peak" ? "from-brand to-aqua" : "from-slate-700 to-slate-500";
  const dims = size === "md" ? "size-9 rounded-xl text-xs" : "size-7 rounded-lg text-[10px]";
  return (
    <span className={`flex shrink-0 items-center justify-center bg-gradient-to-br font-bold tracking-tight text-white ${tone} ${dims}`} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function CompanySwitcher({ items, value, onChange }: { items: SwitcherItem[]; value: string | null; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();

  const current = items.find((i) => i.id === value) ?? items[0];

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
    return (["peak", "netsuite"] as const).map((p) => ({ provider: p, items: shown.filter((i) => i.provider === p) })).filter((g) => g.items.length);
  }, [items, query]);

  if (!current) return null;

  const pick = (id: string) => {
    setOpen(false);
    setQuery("");
    if (id !== value) onChange(id);
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className={`group flex w-56 items-center gap-3 rounded-2xl border bg-white/80 py-1.5 pr-3 pl-1.5 text-left shadow-sm backdrop-blur transition hover:border-slate-300 hover:shadow focus-visible:ring-4 focus-visible:ring-brand/15 focus-visible:outline-none ${
          open ? "border-brand/40 ring-4 ring-brand/10" : "border-slate-200/80"
        }`}
      >
        <Monogram name={current.name} provider={current.provider} />
        {/* Fixed width (w-56): picking a company with a longer name mustn't shift the rest of the header. */}
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium leading-tight text-slate-400">{SOURCE[current.provider]}</span>
          <span className="block truncate text-sm font-semibold leading-tight text-slate-900" title={current.name}>
            {current.name}
          </span>
        </span>
        <svg viewBox="0 0 20 20" className={`ml-1 size-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
          <path d="m5.5 8 4.5 4.5L14.5 8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="rise-in absolute top-full left-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 shadow-xl shadow-slate-900/10 backdrop-blur-xl">
          {items.length >= SEARCH_FROM && (
            <div className="border-b border-slate-100 p-2">
              <input
                ref={search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a company"
                className="w-full rounded-lg bg-slate-50 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-brand/20"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const first = groups.flatMap((g) => g.items).find((i) => !i.disabledReason);
                    if (first) pick(first.id);
                  }
                }}
              />
            </div>
          )}
          <div id={listId} role="listbox" aria-label="Company" className="max-h-80 overflow-y-auto p-1.5">
            {groups.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-400">No match</p>}
            {groups.map((g) => (
              <div key={g.provider} role="group" aria-label={SOURCE[g.provider]}>
                <p className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-slate-400">{SOURCE[g.provider]}</p>
                {g.items.map((i) => {
                  const on = i.id === current.id;
                  return (
                    <button
                      key={i.id}
                      type="button"
                      role="option"
                      aria-selected={on}
                      disabled={Boolean(i.disabledReason)}
                      onClick={() => pick(i.id)}
                      className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
                        on ? "bg-brand-soft/70" : "hover:bg-slate-50"
                      }`}
                    >
                      <Monogram name={i.name} provider={i.provider} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm ${on ? "font-semibold text-brand-dark" : "font-medium text-slate-700"}`}>{i.name}</span>
                        {i.disabledReason && <span className="block truncate text-[11px] text-slate-400">{i.disabledReason}</span>}
                      </span>
                      {on && <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
