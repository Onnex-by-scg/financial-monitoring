"use client";

import Link from "next/link";
import { useState } from "react";
import type { PublicSettings } from "@/lib/settings-types";
import { CompanyForm, DeveloperForm } from "./forms";
import { NetSuiteOnboarding } from "./NetSuite";
import { Button, DoneHeader, EnvPill, NeedList, StatusPill, StepActions, StepTitle, Wizard } from "./ui";

// First-run setup: pick a data source, then its guide.
//  PEAK:     what you need → developer credentials (Client Token test) → first company (User Token test) → done
//  NetSuite: what you need → account → access keys (RESTlet test) → done   (NetSuiteOnboarding in NetSuite.tsx)

type Source = "peak" | "netsuite";

export function Onboarding({ settings, onChange, onExit }: { settings: PublicSettings; onChange: (s: PublicSettings) => void; onExit?: () => void }) {
  const [source, setSource] = useState<Source | null>(null);
  const back = () => setSource(null);

  if (source === "peak") return <PeakOnboarding settings={settings} onChange={onChange} onBack={back} onNetSuite={() => setSource("netsuite")} onExit={onExit} />;
  if (source === "netsuite") return <NetSuiteOnboarding onChange={onChange} onBack={back} onExit={onExit} />;

  const sources: { key: Source; name: string; mark: string; markCls: string; what: string; count: number }[] = [
    { key: "peak", name: "PEAK", mark: "PK", markCls: "bg-brand", what: "AR and Financial Performance", count: settings.companies.length },
    { key: "netsuite", name: "NetSuite", mark: "NS", markCls: "bg-[#1f3b57]", what: "AR from SCG's integration RESTlet", count: settings.netsuite.length },
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Connect a data source</h1>
        <p className="mt-1 text-sm text-slate-500">Each connection becomes a tab on the dashboard.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {sources.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSource(s.key)}
            className="group rounded-2xl border border-slate-200/70 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md focus-visible:ring-4 focus-visible:ring-brand/15 focus-visible:outline-none"
          >
            <div className="flex items-center justify-between">
              <span className={`flex size-10 items-center justify-center rounded-xl text-[11px] font-black tracking-tight text-white ${s.markCls}`} aria-hidden>
                {s.mark}
              </span>
              {s.count > 0 && <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-green-600/15">{s.count} connected</span>}
            </div>
            <p className="mt-4 text-base font-semibold text-slate-900">{s.name}</p>
            <p className="mt-0.5 text-sm text-slate-500">{s.what}</p>
            <p className="mt-4 text-sm font-semibold text-brand opacity-80 transition group-hover:opacity-100">{s.count ? "Add another" : "Set up"}</p>
          </button>
        ))}
      </div>
      {onExit && (
        <div className="mt-6 text-center">
          <button type="button" onClick={onExit} className="text-sm text-slate-500 hover:text-slate-800">
            {settings.companies.length || settings.netsuite.length ? "Back to settings" : "Skip for now"}
          </button>
        </div>
      )}
    </div>
  );
}

const PEAK_STEPS = ["What you need", "Developer", "Company", "Done"];

const PEAK_NEEDS = [
  { label: "Connect ID & Connect Key", from: "In the ZIP from PEAK's API email" },
  { label: "Application Code", from: "Opens the ZIP and lets owners create tokens" },
  { label: "User Token", from: "From each company's PEAK owner" },
];

function PeakOnboarding({
  settings,
  onChange,
  onBack,
  onNetSuite,
  onExit,
}: {
  settings: PublicSettings;
  onChange: (s: PublicSettings) => void;
  onBack: () => void;
  onNetSuite: () => void;
  onExit?: () => void;
}) {
  const [step, setStep] = useState(() => (settings.developer ? (settings.companies.length ? 3 : 2) : 0));
  const [replaceDev, setReplaceDev] = useState(false);
  const dev = settings.developer;

  return (
    <Wizard title="Connect PEAK" steps={PEAK_STEPS} step={step} onClose={onExit}>
      {step === 0 && (
        <>
          <StepTitle title="What you'll need" />
          <NeedList items={PEAK_NEEDS} />
          <a
            className="mt-4 inline-block text-xs font-medium text-brand hover:underline"
            href="https://developers.peakaccount.com/reference/api-integration-guide"
            target="_blank"
            rel="noopener noreferrer"
          >
            No credentials yet? PEAK API guide ↗
          </a>
          <StepActions
            back={
              <Button variant="ghost" onClick={onBack}>
                Back
              </Button>
            }
          >
            <Button onClick={() => setStep(1)}>Continue</Button>
          </StepActions>
        </>
      )}

      {step === 1 && (
        <>
          <StepTitle title="Developer credentials" sub="Shared by every company." />
          {dev && !replaceDev ? (
            <>
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm">
                <EnvPill env={dev.env} />
                <span className="font-mono text-slate-700">{dev.connectIdMasked}</span>
                <StatusPill v={dev.verified} />
                {settings.source === "env" && <span className="text-xs text-slate-400">from .env.local</span>}
              </div>
              <StepActions
                back={
                  <Button variant="ghost" onClick={() => setStep(0)}>
                    Back
                  </Button>
                }
              >
                <Button variant="secondary" onClick={() => setReplaceDev(true)}>
                  Replace
                </Button>
                <Button onClick={() => setStep(2)}>Continue</Button>
              </StepActions>
            </>
          ) : (
            <DeveloperForm
              saved={dev}
              saveLabel="Save and continue"
              cancelLabel="Back"
              onCancel={dev ? () => setReplaceDev(false) : () => setStep(0)}
              onSaved={(s) => {
                onChange(s);
                setReplaceDev(false);
                setStep(2);
              }}
            />
          )}
        </>
      )}

      {step === 2 && (
        <>
          <StepTitle
            title="Connect a company"
            sub={
              settings.companies.length > 0 ? (
                <>
                  Already connected: {settings.companies.map((c) => c.name).join(", ")}.{" "}
                  <button type="button" className="font-medium text-brand hover:underline" onClick={() => setStep(3)}>
                    Skip
                  </button>
                </>
              ) : (
                "Paste the User Token from the company's PEAK owner."
              )
            }
          />
          <CompanyForm shared={dev} saveLabel="Add and continue" cancelLabel="Back" onCancel={() => setStep(1)} onSaved={(s) => (onChange(s), setStep(3))} />
        </>
      )}

      {step === 3 && (
        <>
          <DoneHeader
            title="PEAK is connected"
            sub={`${settings.companies.length} compan${settings.companies.length === 1 ? "y" : "ies"} on the dashboard.`}
          />
          <ul className="mx-auto max-w-md divide-y divide-slate-100 rounded-xl border border-slate-200">
            {settings.companies.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="font-medium text-slate-800">{c.name}</span>
                <span className="flex items-center gap-2">
                  <EnvPill env={c.env} />
                  <StatusPill v={c.verified} />
                </span>
              </li>
            ))}
          </ul>
          <StepActions
            back={
              <Button variant="ghost" onClick={() => setStep(2)}>
                + Add another
              </Button>
            }
          >
            <Button variant="secondary" onClick={onNetSuite}>
              Connect NetSuite too
            </Button>
            <Link href="/" className="inline-flex items-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark">
              Open dashboard
            </Link>
          </StepActions>
        </>
      )}
    </Wizard>
  );
}
