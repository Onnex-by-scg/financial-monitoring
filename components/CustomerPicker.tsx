"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { KPI_OVERDUE_LIMIT } from "@/lib/ar";
import { fmtCompact } from "@/lib/format";

export interface CustomerOption {
  code: string;
  name: string;
  /** Σ remainAmount over the customer's outstanding invoices (THB) */
  amount: number;
  overdue: number;
  documents: number;
  maxOverdueDays: number;
}

type SortMode = "amount" | "name";

/** Searchable customer combobox: type to filter by name or code, ↑↓ to move, Enter to pick, Esc to close. */
export function CustomerPicker({ options, value, onChange }: { options: CustomerOption[]; value: string; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortMode>("amount");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.code === value) ?? null;
  const totalAmount = options.reduce((s, o) => s + o.amount, 0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? options.filter((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q)) : [...options];
    list.sort((a, b) => (sortBy === "amount" ? b.amount - a.amount : a.name.localeCompare(b.name, "th")));
    return list;
  }, [options, query, sortBy]);

  // Row 0 is "All customers" (hidden while searching).
  const items: (CustomerOption | null)[] = query.trim() ? filtered : [null, ...filtered];

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const pick = (code: string) => {
    onChange(code);
    close();
  };
  const openList = () => {
    setActive(
      Math.max(
        0,
        items.findIndex((o) => (o?.code ?? "all") === value),
      ),
    );
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
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
    <div ref={rootRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => (open ? close() : openList())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`group flex w-full items-center gap-3 rounded-lg border bg-white px-3 py-2.5 text-left shadow-sm transition ${
          open ? "border-brand ring-4 ring-brand/15" : "border-slate-200 hover:border-slate-300 hover:shadow"
        }`}
      >
        {selected ? <Avatar name={selected.name} /> : <AllIcon />}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900" title={selected?.name}>
            {selected ? selected.name : "All customers"}
          </span>
          <span className="block truncate text-xs text-slate-500">
            {selected ? `${selected.code} · ฿${fmtCompact(selected.amount)} due` : `${options.length} customers · ฿${fmtCompact(totalAmount)} due`}
          </span>
        </span>
        {selected ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear customer filter"
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
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden>
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </span>
        ) : null}
        <svg viewBox="0 0 20 20" className={`size-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} fill="currentColor" aria-hidden>
          <path
            fillRule="evenodd"
            d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Popover: wider than the sidebar so long Thai company names fit */}
      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[min(26rem,calc(100vw-3rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5">
          <div className="border-b border-slate-100 p-2">
            <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand/40">
              <svg viewBox="0 0 20 20" className="size-4 text-slate-400" fill="currentColor" aria-hidden>
                <path
                  fillRule="evenodd"
                  d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.45 4.39l3.08 3.08a.75.75 0 1 1-1.06 1.06l-3.08-3.08A7 7 0 0 1 2 9Z"
                  clipRule="evenodd"
                />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Search name or code…"
                role="combobox"
                aria-controls={listId}
                aria-expanded
                aria-activedescendant={`${listId}-${active}`}
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
            <div className="mt-2 flex items-center justify-between px-1 text-xs text-slate-500">
              <span>
                {filtered.length} of {options.length}
              </span>
              <div className="flex rounded-md bg-slate-100 p-0.5">
                {(["amount", "name"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setSortBy(m)}
                    className={`rounded px-2 py-0.5 font-medium transition ${sortBy === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                  >
                    {m === "amount" ? "Amount due" : "A–Z"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <ul ref={listRef} id={listId} role="listbox" className="max-h-80 overflow-y-auto p-1.5">
            {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No customer matches “{query}”</li>}
            {items.map((o, i) => {
              const code = o?.code ?? "all";
              const isSelected = code === value;
              return (
                <li
                  key={code}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(code)}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 ${i === active ? "bg-brand-soft" : ""}`}
                >
                  {o ? <Avatar name={o.name} /> : <AllIcon />}
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm ${isSelected ? "font-semibold text-brand" : "font-medium text-slate-900"}`}>
                      {o ? <Highlight text={o.name} query={query} /> : "All customers"}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {o ? (
                        <>
                          <Highlight text={o.code} query={query} /> · {o.documents} doc{o.documents > 1 ? "s" : ""}
                        </>
                      ) : (
                        `${options.length} customers`
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold tabular-nums text-slate-900">฿{fmtCompact(o ? o.amount : totalAmount)}</div>
                    {o && <OverdueBadge option={o} />}
                  </div>
                  <svg viewBox="0 0 20 20" className={`size-4 shrink-0 ${isSelected ? "text-brand" : "text-transparent"}`} fill="currentColor" aria-hidden>
                    <path
                      fillRule="evenodd"
                      d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.58l7.3-7.3a1 1 0 0 1 1.4 0Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">↑↓ to move · Enter to select · Esc to close</div>
        </div>
      )}
    </div>
  );
}

/** Status of the customer's oldest overdue invoice, using the same 30-day KPI line as the rest of the page. */
function OverdueBadge({ option }: { option: CustomerOption }) {
  if (option.overdue <= 0) return <div className="text-[11px] font-medium text-green-700">✓ Current</div>;
  const over = option.maxOverdueDays > KPI_OVERDUE_LIMIT;
  return (
    <div className={`text-[11px] font-medium ${over ? "text-red-700" : "text-amber-700"}`}>
      {over ? "⚠" : "●"} {option.maxOverdueDays}d overdue
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  // Skip Thai company prefixes so the initial is meaningful.
  const clean = name.replace(/^(บริษัท|บจก\.?|ห้างหุ้นส่วน(จำกัด|สามัญ)?|หจก\.?|นาย|นาง(สาว)?|โรงพยาบาล|มหาวิทยาลัย|นิติบุคคล)\s*/, "").trim() || name;
  // Thai leading vowels (เ แ โ ใ ไ) are written before the consonant, so skip them: ไทย → ท.
  const initial = [...clean.replace(/^[เแโใไ]+/, "")][0]?.toUpperCase() ?? "?";
  // Stable soft tint per name; identity only, so the hue carries no meaning.
  const tints = [
    "bg-brand-soft text-brand",
    "bg-violet-100 text-violet-800",
    "bg-teal-100 text-teal-800",
    "bg-sky-100 text-sky-800",
    "bg-indigo-100 text-indigo-800",
    "bg-slate-200 text-slate-700",
  ];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${tints[h % tints.length]}`}>{initial}</span>;
}

function AllIcon() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-white">
      <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden>
        <path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.5 1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.6 15.1A5.5 5.5 0 0 1 12.4 15a.9.9 0 0 1-.4 1A9 9 0 0 1 7 17.5 9 9 0 0 1 2 16a.9.9 0 0 1-.4-.9Zm12.9.9h.2c1.3 0 2.5-.3 3.6-.8a.8.8 0 0 0 .5-.8 4 4 0 0 0-5.6-3.3 7 7 0 0 1 1.3 4.9Z" />
      </svg>
    </span>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-yellow-200/70 px-0.5 text-inherit">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}
