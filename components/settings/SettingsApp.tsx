"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PublicCompany, PublicSettings, TestResponse } from "@/lib/settings-types";
import { api } from "./api";
import { CompanyForm, DeveloperForm } from "./forms";
import { NetSuiteSection } from "./NetSuite";
import { Onboarding } from "./Onboarding";
import { SyncSection } from "./SyncSection";
import { Alert, Button, Card, Chip, EnvPill, Modal, StatusPill, TestResultAlert } from "./ui";

type Section = "developer" | "companies" | "netsuite" | "sync";

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
        {
          group: "Data sources",
          items: [
            { key: "companies", label: "PEAK companies", badge: `${settings.companies.length}` },
            { key: "developer", label: "PEAK developer", badge: settings.developer ? "" : "!" },
            { key: "netsuite", label: "NetSuite", badge: settings.netsuite.length ? `${settings.netsuite.length}` : "" },
          ],
        },
        { group: "Dashboard", items: [{ key: "sync", label: "Data sync", badge: "" }] },
      ]
    : [];

  return (
    <div className="min-h-screen bg-[#F3F6FA] text-ink">
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

      <main className="mx-auto max-w-6xl px-6 py-8">
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
            <aside className="space-y-6 md:sticky md:top-24 md:self-start">
              <nav className="space-y-6" aria-label="Settings sections">
                {nav.map((g) => (
                  <div key={g.group}>
                    <h2 className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">{g.group}</h2>
                    <div className="space-y-1">
                      {g.items.map((it) => {
                        const on = section === it.key;
                        return (
                          <button
                            key={it.key}
                            type="button"
                            aria-current={on ? "page" : undefined}
                            onClick={() => setSection(it.key)}
                            className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
                              on ? "bg-white shadow-sm" : "hover:bg-white/70"
                            }`}
                          >
                            <span className={`min-w-0 flex-1 text-sm font-semibold ${on ? "text-slate-900" : "text-slate-600"}`}>{it.label}</span>
                            {it.badge && (
                              <span
                                className={`rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums ${
                                  it.badge === "!" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                {it.badge}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </nav>
              <p className="px-3 text-xs text-slate-400">Stored on this server only. Keys are masked here.</p>
            </aside>

            <div key={section} className="rise-in min-w-0 space-y-4">
              {settings.source === "sample" && (
                <Alert kind="info" title="Sample mode">
                  Companies and keys here are made up. Changes are kept in memory only and reset when the dev server restarts; nothing is
                  sent to PEAK, NetSuite or the database.
                </Alert>
              )}
              {settings.source === "env" && section !== "netsuite" && section !== "sync" && (
                <Alert kind="info" title="Using values from .env.local">
                  These credentials come from <code>.env.local</code>. Saving any change here stores them in {settings.storagePath}, which is used
                  from then on.
                </Alert>
              )}
              {section === "developer" && <DeveloperSection settings={settings} onChange={setSettings} />}
              {section === "companies" && <CompaniesSection settings={settings} onChange={setSettings} />}
              {section === "netsuite" && <NetSuiteSection settings={settings} onChange={setSettings} />}
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
      title="Developer credentials"
      description="Shared by every company that doesn't have its own."
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
              Used by {settings.companies.filter((c) => !c.ownDeveloper).length} of {settings.companies.length} companies.
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

function CompaniesSection({ settings, onChange }: { settings: PublicSettings; onChange: (s: PublicSettings) => void }) {
  const [modal, setModal] = useState<{ mode: "add" } | { mode: "edit"; company: PublicCompany } | null>(null);

  return (
    <Card
      title="Companies"
      description="Each company is a tab on the dashboard."
      action={<Button onClick={() => setModal({ mode: "add" })}>+ Add company</Button>}
    >
      {settings.companies.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">No companies yet.</div>
      ) : (
        <ul className="space-y-3">
          {settings.companies.map((c) => (
            <CompanyRow key={c.id} company={c} onEdit={() => setModal({ mode: "edit", company: c })} onChange={onChange} />
          ))}
        </ul>
      )}

      {modal && (
        <Modal title={modal.mode === "add" ? "Add company" : `Edit ${modal.company.name}`} onClose={() => setModal(null)}>
          <CompanyForm
            company={modal.mode === "edit" ? modal.company : undefined}
            shared={settings.developer}
            onCancel={() => setModal(null)}
            onSaved={(s) => {
              onChange(s);
              setModal(null);
            }}
          />
        </Modal>
      )}
    </Card>
  );
}

function CompanyRow({ company: c, onEdit, onChange }: { company: PublicCompany; onEdit: () => void; onChange: (s: PublicSettings) => void }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResponse | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.testCompany({ id: c.id }));
      onChange(await api.settings()); // refresh the saved "last tested" status
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{c.name}</span>
            <EnvPill env={c.env} />
            <StatusPill v={c.verified} />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-slate-500">
            {c.verified?.businessName && <Chip k="PEAK business">{c.verified.businessName}</Chip>}
            <Chip k="User Token" mono>
              {c.userTokenMasked}
            </Chip>
            <Chip k="Developer">{c.ownDeveloper ? `own (${c.ownDeveloper.connectIdMasked})` : "shared"}</Chip>
          </div>
        </div>
        {confirmDelete ? (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-900">
            Remove {c.name}?
            <Button
              variant="danger"
              size="sm"
              loading={deleting}
              onClick={async () => {
                setDeleting(true);
                try {
                  onChange((await api.deleteCompany(c.id)).settings);
                } catch (e) {
                  setError((e as Error).message);
                  setDeleting(false);
                }
              }}
            >
              Remove
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" loading={testing} onClick={test}>
              Test
            </Button>
            <Button variant="secondary" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" className="text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => setConfirmDelete(true)}>
              Remove
            </Button>
          </div>
        )}
      </div>
      {(result || error) && <div className="mt-3">{result ? <TestResultAlert result={result} /> : <Alert kind="err">{error}</Alert>}</div>}
    </li>
  );
}
