"use client";

import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { BASE_URLS_PUBLIC, ENV_LABEL, type PeakEnvName, type TestResponse, type Verification } from "@/lib/settings-types";
import { timeAgo } from "./api";

export function Button({
  variant = "primary",
  size = "md",
  loading,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; loading?: boolean }) {
  const styles = {
    primary: "bg-brand text-white hover:bg-brand-dark shadow-sm",
    secondary: "border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900",
    ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
    danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
  }[variant];
  const sizes = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${styles} ${sizes} ${className}`}
    >
      {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-800">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand focus:ring-4 focus:ring-brand/15";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input spellCheck={false} autoComplete="off" {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

/** Password-style input with a show/hide toggle. */
export function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="new-password"
        className={`${inputCls} pr-16 font-mono`}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

export function EnvPicker({ value, onChange }: { value: PeakEnvName; onChange: (v: PeakEnvName) => void }) {
  const notes: Record<PeakEnvName, string> = {
    uat: "For testing. Open Mon–Fri 08:00–22:00 (Bangkok).",
    production: "Live data. Needs a Production credential from PEAK.",
  };
  return (
    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
      {(["uat", "production"] as const).map((env) => {
        const on = value === env;
        return (
          <button
            key={env}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(env)}
            className={`rounded-xl border p-3 text-left transition ${on ? "border-brand bg-brand-soft/60 ring-4 ring-brand/10" : "border-slate-200 bg-white hover:border-slate-300"}`}
          >
            <div className="flex items-center gap-2">
              <span className={`flex size-4 items-center justify-center rounded-full border-2 ${on ? "border-brand" : "border-slate-300"}`}>
                {on && <span className="size-2 rounded-full bg-brand" />}
              </span>
              <span className="text-sm font-semibold">{ENV_LABEL[env]}</span>
            </div>
            <div className="mt-1 pl-6 font-mono text-[11px] text-slate-500">{BASE_URLS_PUBLIC[env].replace("https://", "")}</div>
            <div className="mt-0.5 pl-6 text-xs text-slate-500">{notes[env]}</div>
          </button>
        );
      })}
    </div>
  );
}

export function Alert({ kind, title, children }: { kind: "ok" | "err" | "warn" | "info"; title?: ReactNode; children?: ReactNode }) {
  const s = {
    ok: "border-green-200/80 bg-green-50/70 text-green-900",
    err: "border-red-200/80 bg-red-50/70 text-red-900",
    warn: "border-amber-200/80 bg-amber-50/70 text-amber-900",
    info: "border-brand/20 bg-brand-soft/70 text-brand-dark",
  }[kind];
  return (
    <div role={kind === "err" ? "alert" : "status"} className={`slide-down rounded-xl border px-4 py-3 text-sm ${s}`}>
      <div className="min-w-0 break-words">
        {title && <div className="font-semibold">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function TestResultAlert({ result }: { result: TestResponse }) {
  if (result.ok && result.arEndpoint && !result.arEndpoint.ok) {
    return (
      <div className="space-y-2">
        <TestResultAlert result={{ ...result, arEndpoint: undefined }} />
        <Alert kind="warn" title="The dashboard can't read AR with this token yet">
          {result.arEndpoint.message} Ask the NetSuite admin to let this role run customscript_int_api_2.
        </Alert>
      </div>
    );
  }
  if (!result.ok)
    return (
      <Alert kind="err" title="Connection test failed">
        {result.message}
      </Alert>
    );
  const b = result.business;
  return (
    <Alert kind="ok" title={result.message}>
      {b && (
        <span className="text-green-800">
          {b.userName || b.userEmail ? `Authorized by ${[b.userName, b.userEmail && `(${b.userEmail})`].filter(Boolean).join(" ")}. ` : ""}
          {b.package ? `PEAK package: ${b.package}.` : ""}
        </span>
      )}
      {result.subsidiaries && result.subsidiaries.length > 0 && (
        <span className="mt-1 block text-green-800">
          Subsidiaries: {result.subsidiaries.slice(0, 8).join(", ")}
          {result.subsidiaries.length > 8 ? ` and ${result.subsidiaries.length - 8} more` : ""}.
        </span>
      )}
      {result.arEndpoint?.ok && <span className="mt-1 block text-green-800">✓ {result.arEndpoint.message}</span>}
    </Alert>
  );
}

export function StatusPill({ v }: { v: Verification | null }) {
  const pill = "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset";
  if (!v)
    return (
      <span className={`${pill} bg-slate-50 text-slate-600 ring-slate-200`}>
        <span className="size-1.5 rounded-full bg-slate-400" aria-hidden />
        Not tested
      </span>
    );
  return v.ok ? (
    <span className={`${pill} bg-green-50 text-green-800 ring-green-600/20`} title={v.message}>
      <span className="size-1.5 rounded-full bg-green-500" aria-hidden />Connected · {timeAgo(v.at)}
    </span>
  ) : (
    <span className={`${pill} bg-red-50 text-red-800 ring-red-600/20`} title={v.message}>
      <span className="size-1.5 rounded-full bg-red-500" aria-hidden />Failed · {timeAgo(v.at)}
    </span>
  );
}

export function EnvPill({ env }: { env: PeakEnvName | null }) {
  if (!env) return null;
  return env === "uat" ? (
    <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-800 ring-1 ring-violet-600/20 ring-inset">UAT</span>
  ) : (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-600/20 ring-inset">Production</span>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-[2px] sm:p-10" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="rise-in w-full max-w-2xl rounded-2xl border border-slate-200/70 bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-2 text-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            ×
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-start gap-3 text-left">
      <span className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${checked ? "bg-brand" : "bg-slate-300"}`}>
        <span className={`size-4 rounded-full bg-white shadow transition ${checked ? "translate-x-4" : ""}`} />
      </span>
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </button>
  );
}

export function Card({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
          {description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Stepper({ steps, step }: { steps: string[]; step: number }) {
  return (
    <ol className="mb-6 flex items-center gap-2">
      {steps.map((label, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                done ? "bg-brand text-white" : current ? "bg-brand-soft text-brand ring-2 ring-brand" : "bg-slate-200 text-slate-500"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span className={`hidden text-sm sm:block ${current ? "font-semibold text-slate-900" : "text-slate-500"}`}>{label}</span>
            {i < steps.length - 1 && <span className={`h-px flex-1 ${done ? "bg-brand" : "bg-slate-200"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

/** A checklist the user ticks before a setup guide continues. */
export function Checklist({ items, checked, onChange }: { items: ReactNode[]; checked: boolean[]; onChange: (v: boolean[]) => void }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i}>
          <label
            className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm transition ${checked[i] ? "border-brand/25 bg-brand-soft/50" : "border-slate-200 hover:bg-slate-50"}`}
          >
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-brand"
              checked={checked[i]}
              onChange={(e) => onChange(checked.map((v, j) => (j === i ? e.target.checked : v)))}
            />
            <span className="text-slate-700">{item}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/** Small "label value" chip for a connection's details. */
export function Chip({ k, mono, children }: { k: string; mono?: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-0.5 ring-1 ring-slate-200/70 ring-inset">
      <span className="text-slate-400">{k}</span>
      <span className={`text-slate-700 ${mono ? "font-mono" : ""}`}>{children}</span>
    </span>
  );
}
