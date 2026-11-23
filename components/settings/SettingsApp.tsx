"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PublicSettings, TestResponse } from "@/lib/settings-types";
import { api } from "./api";
import { CompaniesSection } from "./Companies";
import { DeveloperForm } from "./forms";
import { Onboarding } from "./Onboarding";
import { SyncSection } from "./SyncSection";
import { Alert, Button, Card, EnvPill, StatusPill, TestResultAlert } from "./ui";

type Section = "companies" | "developer" | "sync";

export default function SettingsApp() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wizard, setWizard] = useState<boolean | null>(null);
  const [section, setSection] = useState<Section>("companies");

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setSettings(s);
        // First run: the setup guide until something (PEAK or NetSuite) is connected.
        setWizard(s.companies.length === 0 && s.netsuite.length === 0);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const nav: { group: string; items: { key: Section; label: string; badge: string }[] }[] = settings
    ? [
        { group: "Dashboard", items: [{ key: "companies", label: "Companies", badge: `${settings.companies.length + settings.netsuite.length}` }] },
        {
          group: "Connections",
          items: [
            // Only flag missing PEAK keys when a PEAK company relies on the shared ones.
            { key: "developer", label: "PEAK API keys", badge: !settings.developer && settings.companies.some((c) => !c.ownDeveloper) ? "!" : "" },
            { key: "sync", label: "Data sync", badge: "" },
          ],
        },
      ]
    : [];

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#F3F6FA] text-ink">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-0">
        <div className="absolute -top-40 -left-32 size-[460px] rounded-full bg-brand/10 blur-3xl" />
        <div className="absolute top-1/3 -left-40 size-[380px] rounded-full bg-aqua/10 blur-3xl" />
      </div>
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-3">
          <Link
            href="/"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900"
          >
            Dashboard
          </Link>
          <div>
            <p className="text-xs font-semibold text-slate-400">
              <span className="text-brand">AR</span> <span className="text-aqua">·</span> ESCO
            </p>
            <h1 className="-mt-0.5 text-xl font-bold tracking-tight">Settings</h1>
          </div>
          {settings && !wizard && (
            <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setWizard(true)}>
              Setup guide
            </Button>
          )}
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-6 py-8">
        {loadError && (
          <Alert kind="err" title="Couldn't load settings">
            {loadError}
          </Alert>
        )}
        {!settings && !loadError && <div className="h-64 animate-pulse rounded-2xl bg-white" />}

        {settings && wizard && (
          <div className="rise-in">
            <Onboarding settings={settings} onChange={setSettings} onExit={() => setWizard(false)} />
          </div>
        )}

        {settings && wizard === false && (
          <div className="grid gap-8 md:grid-cols-[200px_minmax(0,1fr)]">
            {/* Glass sidebar: a translucent panel over the page's soft colour wash. On phones it becomes a scrollable row. */}
            <aside className="md:sticky md:top-24 md:self-start">
              <nav
                aria-label="Settings sections"
                className="flex gap-1 overflow-x-auto rounded-2xl border border-white/70 bg-white/40 p-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-16px_rgba(15,23,42,0.18)] backdrop-blur-xl md:block md:space-y-1 md:p-2"
              >
                {nav.map((g) => (
                  <div key={g.group} className="contents md:block">
                    <h2 className="hidden px-3 pt-3 pb-1.5 text-[11px] font-medium tracking-wide text-slate-400 first:pt-1.5 md:block">{g.group}</h2>
                    {g.items.map((it) => {
                      const on = section === it.key;
                      return (
                        <button
                          key={it.key}
                          type="button"
                          aria-current={on ? "page" : undefined}
                          onClick={() => setSection(it.key)}
                          className={`relative flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm whitespace-nowrap transition md:w-full ${
                            on
                              ? "bg-white/85 font-semibold text-slate-900 shadow-sm ring-1 ring-slate-900/[0.04]"
                              : "font-medium text-slate-500 hover:bg-white/50 hover:text-slate-800"
                          }`}
                        >
                          <span className="min-w-0 flex-1">{it.label}</span>
                          {it.badge === "!" ? (
                            <span className="size-2 rounded-full bg-amber-400" title="Needs setup" aria-label="Needs setup" />
                          ) : (
                            it.badge && <span className={`text-xs tabular-nums ${on ? "text-slate-500" : "text-slate-400"}`}>{it.badge}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </nav>
            </aside>

            <div key={section} className="rise-in min-w-0 space-y-4">
              {settings.source === "sample" && (
                <Alert kind="info" title="Sample mode">
                  Companies and keys here are made up. Changes are kept in memory only and reset when the dev server restarts; nothing is
                  sent to PEAK, NetSuite or the database.
                </Alert>
              )}
              {settings.source === "env" && section !== "sync" && (
                <Alert kind="info" title="Using values from .env.local">
                  These credentials come from <code>.env.local</code>. Saving any change here stores them in {settings.storagePath}, which is used
                  from then on.
                </Alert>
              )}
              {section === "developer" && <DeveloperSection settings={settings} onChange={setSettings} />}
              {section === "companies" && <CompaniesSection settings={settings} onChange={setSettings} />}
              {section === "sync" && <SyncSection />}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function DeveloperSection({ settings, onChange }: { settings: PublicSettings; onChange: (s: PublicSettings) => void }) {
  const dev = settings.developer;
  const [editing, setEditing] = useState(!dev);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResponse | null>(null);

  return (
    <Card
      eyebrow="Connections"
      title="PEAK API keys"
      description="Connect ID and Connect Key from PEAK, shared by every PEAK company that doesn't have its own. NetSuite companies use their own access keys."
      action={
        dev &&
        !editing && (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={testing}
              onClick={async () => {
                setTesting(true);
                setResult(null);
                try {
                  setResult(await api.testDeveloper({ env: dev.env }));
                  onChange(await api.settings()); // refresh the saved "last tested" status
                } catch (e) {
                  setResult({ ok: false, message: (e as Error).message });
                } finally {
                  setTesting(false);
                }
              }}
            >
              Test
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        )
      }
    >
      {editing ? (
        <DeveloperForm
          saved={dev}
          onCancel={dev ? () => setEditing(false) : undefined}
          onSaved={(s) => {
            onChange(s);
            setEditing(false);
            setResult(null);
          }}
        />
      ) : (
        dev && (
          <div className="space-y-4">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <Item label="Environment">
                <EnvPill env={dev.env} /> <span className="ml-1 font-mono text-xs text-slate-500">{dev.baseUrl}</span>
              </Item>
              <Item label="Status">
                <StatusPill v={dev.verified} />
              </Item>
              <Item label="Connect ID">
                <span className="font-mono">{dev.connectIdMasked}</span>
              </Item>
              <Item label="Connect Key">
                <span className="font-mono">{dev.hasConnectKey ? "•••••••• (saved)" : "not set"}</span>
              </Item>
            </dl>
            {result && <TestResultAlert result={result} />}
            <p className="text-xs text-slate-500">
              Used by {settings.companies.filter((c) => !c.ownDeveloper).length} of {settings.companies.length} PEAK companies.
            </p>
          </div>
        )
      )}
    </Card>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
