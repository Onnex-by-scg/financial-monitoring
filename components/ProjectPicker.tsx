"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fmtCompact } from "@/lib/format";

// The AR filter bar's project picker: a two-line trigger like the customer picker beside it, and a panel where each
// project shows its share of the AR as a slim bar (current | overdue). Type to filter, ↑↓ to move, Enter to pick.

export interface ProjectOption {
  code: string;
  name: string;
  documents: number;
  current: number;
  overdue: number;
  amount: number;
}

const SEARCH_FROM = 7;

export function ProjectPicker({
  options,
  value,
  onChange,
  noProjectCode,
}: {
  options: ProjectOption[];
  value: string;
  onChange: (code: string) => void;
  /** The code used for invoices without a project; shown as "No project". */
  noProjectCode: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();

  const label = (o: ProjectOption) => (o.code === noProjectCode ? "No project" : o.name);
  const selected = options.find((o) => o.code === value) ?? null;
  const total = options.reduce((s, o) => s + o.amount, 0);
  const projectCount = options.filter((o) => o.code !== noProjectCode).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => label(o).toLowerCase().includes(q) || o.code.toLowerCase().includes(q)) : options;
    // label depends only on noProjectCode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, query, noProjectCode]);

  // Row 0 is "All projects" (hidden while searching).
  const items: (ProjectOption | null)[] = query.trim() ? filtered : [null, ...filtered];

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const pick = (code: string) => {
    onChange(code);
    close();
  };
  const toggle = () => {
    if (open) return close();
    setActive(Math.max(0, items.findIndex((o) => (o?.code ?? "all") === value)));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[active];
      if (item !== undefined) pick(item?.code ?? "all");
    } else if (e.key === "Escape") {
      close();
    }
  };

  return (
    <div ref={root} className="relative" onKeyDown={open ? onKeyDown : undefined}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Project"
        className={`flex w-full items-center gap-3 rounded-lg border bg-white px-3 py-2.5 text-left shadow-sm transition ${
          open ? "border-brand ring-4 ring-brand/15" : "border-slate-200 hover:border-slate-300 hover:shadow"
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-snug text-slate-900" title={selected ? label(selected) : undefined}>
            {selected ? label(selected) : "All projects"}
          </span>
          <span className="block truncate text-xs text-slate-500">
            {selected
              ? `${selected.code === noProjectCode ? "Unassigned" : selected.code} · ฿${fmtCompact(selected.amount)} due · ${selected.documents} docs`
              : `${projectCount} projects · ฿${fmtCompact(total)} due`}
          </span>
        </span>
        {selected && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear project filter"
            onClick={(e) => {
              e.stopPropagation();
              pick("all");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                pick("all");
              }
            }}
            className="rounded-md px-1.5 py-0.5 text-base leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ×
          </span>
        )}
        <svg viewBox="0 0 20 20" className={`size-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
          <path d="m5.5 8 4.5 4.5L14.5 8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="rise-in absolute top-full left-0 z-40 mt-2 w-[min(24rem,calc(100vw-3rem))] overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 shadow-xl shadow-slate-900/10 backdrop-blur-xl">
          {options.length >= SEARCH_FROM && (
            <div className="border-b border-slate-100 p-2">
              <input
                ref={input}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder="Find a project"
                role="combobox"
                aria-controls={listId}
                aria-expanded
                aria-activedescendant={`${listId}-${active}`}
                className="w-full rounded-lg bg-slate-50 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-brand/20"
              />
            </div>
          )}

          <ul ref={list} id={listId} role="listbox" aria-label="Project" tabIndex={-1} className="max-h-80 overflow-y-auto p-1.5 outline-none">
            {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-400">No match</li>}
            {items.map((o, i) => {
              const code = o?.code ?? "all";
              const on = code === value;
              const hot = i === active;
              const amount = o ? o.amount : total;
              const share = total > 0 ? amount / total : 0;
              return (
                <li
                  key={code}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={on}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(code)}
                  className={`cursor-pointer rounded-xl px-3 py-2.5 transition ${hot ? "bg-slate-50" : ""} ${on ? "bg-brand-soft/70" : ""} ${
                    o?.code === noProjectCode ? "mt-1 border-t border-slate-100" : ""
                  }`}
                >
                  <div className="flex items-baseline gap-3">
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${on ? "font-semibold text-brand-dark" : "font-medium text-slate-800"}`}>
                        {o ? label(o) : "All projects"}
                      </span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {o ? (o.code === noProjectCode ? "Invoices without a project" : o.code) : `${projectCount} projects`}
                        {o ? ` · ${o.documents} docs` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold text-slate-700 tabular-nums">฿{fmtCompact(amount)}</span>
                      {o && <span className="block text-[11px] text-slate-400 tabular-nums">{Math.round(share * 100)}%</span>}
                    </span>
                  </div>
                  {o && (
                    <div className="mt-2 flex h-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                      <span className="h-full bg-brand" style={{ width: `${total ? (100 * o.current) / total : 0}%` }} />
                      <span className="h-full bg-red-400" style={{ width: `${total ? (100 * o.overdue) / total : 0}%` }} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="flex items-center gap-4 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-brand" aria-hidden />
              Current
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-red-400" aria-hidden />
              Overdue
            </span>
            <span className="ml-auto">Share of AR</span>
          </div>
        </div>
      )}
    </div>
  );
}
