"use client";

import { useState } from "react";
import { type PublicCompany, type PublicNetSuite, type PublicSettings, type TestResponse, type Verification } from "@/lib/settings-types";
import { api, timeAgo } from "./api";
import { CompanyForm } from "./forms";
import { NetSuiteEditForm, NetSuiteOnboarding } from "./NetSuite";
import { Alert, Button, CardGlow, IconButton, Modal, SectionHeading, TestResultAlert } from "./ui";

// Settings → Companies: every dashboard tab in one list, whatever its data source.
// Adding a company starts with the source (PEAK or NetSuite), then that source's form.

type Source = "peak" | "netsuite";
type Filter = "all" | Source;

/** One row of the list: a PEAK company or a NetSuite connection. */
type Entry = { source: "peak"; item: PublicCompany } | { source: "netsuite"; item: PublicNetSuite };

const SOURCE_LABEL: Record<Source, string> = { peak: "PEAK", netsuite: "NetSuite" };

export function CompaniesSection({ settings, onChange }: { settings: PublicSettings; onChange: (s: PublicSettings) => void }) {
  const [view, setView] = useState<"list" | "choose" | Source>("list");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Entry | null>(null);

  // Same order as the dashboard's tabs: PEAK companies first, then NetSuite connections.
  const entries: Entry[] = [
    ...settings.companies.map((item) => ({ source: "peak" as const, item })),
    ...settings.netsuite.map((item) => ({ source: "netsuite" as const, item })),
  ];
  const shown = filter === "all" ? entries : entries.filter((e) => e.source === filter);
  const counts: Record<Filter, number> = { all: entries.length, peak: settings.companies.length, netsuite: settings.netsuite.length };

  if (view === "choose") return <ChooseSource settings={settings} onPick={setView} onCancel={() => setView("list")} />;

  if (view === "netsuite") return <NetSuiteOnboarding onChange={onChange} onBack={() => setView("choose")} onExit={() => setView("list")} />;

  if (view === "peak")
    return (
      <Panel title="Add a PEAK company">
        {!settings.developer && (
          <p className="mb-5 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            No shared PEAK API keys yet, so enter this company&apos;s Connect ID and Connect Key below. To share one set of keys across companies, add
            them under PEAK API keys.
          </p>
        )}
        <CompanyForm
          shared={settings.developer}
          cancelLabel="Back"
          onCancel={() => setView("choose")}
          onSaved={(s) => {
            onChange(s);
            setFilter("all");
            setView("list");
          }}
        />
      </Panel>
    );

  return (
    <section className="relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
      <CardGlow />
      <div className="relative px-6 pt-6 pb-4">
        <SectionHeading eyebrow="Dashboard" title="Companies" action={<Button onClick={() => setView("choose")}>Add company</Button>} />
      </div>

      {entries.length > 0 && (
        <div className="relative px-6 pb-3">
          <div className="inline-flex gap-1 rounded-xl bg-slate-100/80 p-1" role="tablist" aria-label="Filter by source">
            {(["all", "peak", "netsuite"] as const).map((f) => {
              const on = filter === f;
              return (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setFilter(f)}
                  className={`rounded-lg px-3 py-1.5 text-sm transition ${
                    on ? "bg-white font-semibold text-slate-900 shadow-sm" : "font-medium text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {f === "all" ? "All" : SOURCE_LABEL[f]}
                  <span className={`ml-1.5 tabular-nums ${on ? "text-slate-500" : "text-slate-400"}`}>{counts[f]}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="px-6 pb-10 pt-6 text-center">
          <p className="text-sm font-medium text-slate-800">No companies yet</p>
          <p className="mt-1 text-sm text-slate-500">Add one from PEAK or NetSuite to start the dashboard.</p>
          <Button className="mt-5" onClick={() => setView("choose")}>
            Add company
          </Button>
        </div>
      ) : shown.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-slate-500">No {SOURCE_LABEL[filter as Source]} companies yet.</p>
      ) : (
        <ul className="relative divide-y divide-slate-100 border-t border-slate-100">
          {shown.map((e) => (
            <CompanyRow key={`${e.source}:${e.item.id}`} entry={e} onEdit={() => setEditing(e)} onChange={onChange} />
          ))}
        </ul>
      )}

      {editing && (
        <Modal title={`Edit ${editing.item.name}`} onClose={() => setEditing(null)}>
          {editing.source === "peak" ? (
            <CompanyForm
              company={editing.item}
              shared={settings.developer}
              onCancel={() => setEditing(null)}
              onSaved={(s) => {
                onChange(s);
                setEditing(null);
              }}
            />
          ) : (
            <NetSuiteEditForm
              connection={editing.item}
              onCancel={() => setEditing(null)}
              onSaved={(s) => {
                onChange(s);
                setEditing(null);
              }}
            />
          )}
        </Modal>
      )}
    </section>
  );
}

// ---------- Step 1 of adding: the data source ----------

function ChooseSource({ settings, onPick, onCancel }: { settings: PublicSettings; onPick: (s: Source) => void; onCancel: () => void }) {
  const options: { key: Source; title: string; body: string; count: number }[] = [
    { key: "peak", title: "PEAK", body: "AR aging and Financial Performance, read with the company's PEAK User Token.", count: settings.companies.length },
    { key: "netsuite", title: "NetSuite", body: "AR aging from SCG's NetSuite integration, read with a NetSuite access token.", count: settings.netsuite.length },
  ];
  return (
    <Panel title="Add a company" sub="Where does this company's data come from?" onBack={onCancel} backLabel="Cancel">
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Data source">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onPick(o.key)}
            className="group rounded-xl border border-slate-200 p-5 text-left transition hover:border-brand/50 hover:bg-brand-soft/30 focus-visible:ring-4 focus-visible:ring-brand/15 focus-visible:outline-none"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-base font-semibold text-slate-900">{o.title}</span>
              {o.count > 0 && <span className="text-xs text-slate-400">{o.count} added</span>}
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{o.body}</p>
            <p className="mt-4 text-sm font-semibold text-brand">Continue</p>
          </button>
        ))}
      </div>
    </Panel>
  );
}

/** A full-width card for the add flow, with a quiet Back link in the header. */
function Panel({
  title,
  sub,
  onBack,
  backLabel = "Back",
  children,
}: {
  title: string;
  sub?: string;
  /** Header link; leave out when the form has its own Back button. */
  onBack?: () => void;
  backLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rise-in mx-auto max-w-2xl rounded-2xl border border-slate-200/70 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
          {sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}
        </div>
        {onBack && (
          <button type="button" onClick={onBack} className="rounded-md px-2 py-1 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">
            {backLabel}
          </button>
        )}
      </div>
      <div className="px-6 py-6">{children}</div>
    </section>
  );
}

// ---------- One row ----------


function CompanyRow({ entry: e, onEdit, onChange }: { entry: Entry; onEdit: () => void; onChange: (s: PublicSettings) => void }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResponse | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { item } = e;

  const test = async () => {
    setTesting(true);
    setResult(null);
    setError(null);
    try {
      setResult(e.source === "peak" ? await api.testCompany({ id: item.id }) : await api.testNetSuite({ id: item.id }));
      onChange(await api.settings()); // refresh the saved "last tested" status
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      onChange((e.source === "peak" ? await api.deleteCompany(item.id) : await api.deleteNetSuite(item.id)).settings);
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
    }
  };

  return (
    <li className="px-6 py-4 transition hover:bg-slate-50/60">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 basis-full sm:basis-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-semibold text-slate-900">{item.name}</span>
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-slate-600 uppercase">
              {SOURCE_LABEL[e.source]}
            </span>
          </div>
        </div>

        <Status v={item.verified} />

        {confirmDelete ? (
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <span>Remove {item.name} and its saved data?</span>
            <Button variant="danger" size="sm" loading={deleting} onClick={remove}>
              Remove
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
          </div>
        ) : (
          <div className="-ml-2 flex items-center gap-0.5 sm:ml-0">
            <IconButton icon="test" label={`Test connection to ${SOURCE_LABEL[e.source]}`} loading={testing} onClick={test} />
            <IconButton icon="edit" label={`Edit ${item.name}`} onClick={onEdit} />
            <IconButton icon="remove" label={`Remove ${item.name}`} tone="danger" onClick={() => setConfirmDelete(true)} />
          </div>
        )}
      </div>
      {(result || error) && <div className="mt-3">{result ? <TestResultAlert result={result} /> : <Alert kind="err">{error}</Alert>}</div>}
    </li>
  );
}

/** Last connection test, as a coloured dot and a few words. */
function Status({ v }: { v: Verification | null }) {
  const [dot, text, label] = !v
    ? ["bg-slate-300", "text-slate-500", "Not tested"]
    : v.ok
      ? ["bg-green-500", "text-slate-600", `Connected ${timeAgo(v.at)}`]
      : ["bg-red-500", "text-red-700", `Failed ${timeAgo(v.at)}`];
  return (
    <span className={`inline-flex items-center gap-2 text-sm ${text}`} title={v?.message}>
      <span className={`size-2 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  );
}
