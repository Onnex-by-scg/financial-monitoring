"use client";

import Link from "next/link";
import { useState } from "react";
import type { PublicSettings } from "@/lib/settings-types";
import { CompanyForm, DeveloperForm } from "./forms";
import { Button, Checklist, EnvPill, StatusPill, Stepper } from "./ui";

// First-run setup, adapted from ../peak_account's onboarding wizard:
// 1 prerequisites → 2 developer credentials (Client Token test) → 3 first company (User Token test) → 4 done.

const STEPS = ["Get started", "Developer credentials", "Connect a company", "Done"];

const CHECKLIST = [
  <>
    I have <b>requested API access</b> from PEAK and named a developer contact.
  </>,
  <>
    I received the email <b>“PEAK API - ข้อมูลสำหรับเชื่อมต่อแพลตฟอร์ม”</b> with an encrypted ZIP holding the <b>Connect ID</b> and <b>Connect Key</b>.
  </>,
  <>
    I received the email <b>“PEAK API UAT Application Code”</b>. The Application Code opens the ZIP, and company owners use it to create a User Token.
  </>,
  <>
    I can reach the <b>owner / admin</b> of each company&apos;s PEAK account.
  </>,
];

export function Onboarding({ settings, onChange, onExit }: { settings: PublicSettings; onChange: (s: PublicSettings) => void; onExit?: () => void }) {
  const [step, setStep] = useState(() => (settings.developer ? (settings.companies.length ? 3 : 2) : 0));
  const [checked, setChecked] = useState<boolean[]>(() => CHECKLIST.map(() => false));
  const [replaceDev, setReplaceDev] = useState(false);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Connect the dashboard to PEAK</h1>
        <p className="mt-1 text-sm text-slate-500">A few minutes, once. Credentials are saved on this server only.</p>
      </div>

      <Stepper steps={STEPS} step={step} />

      <div className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
        {step === 0 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">Before you start</h2>
              <p className="text-sm text-slate-500">PEAK sends these by email after you request API access. Tick each one.</p>
            </div>
            <Checklist items={CHECKLIST} checked={checked} onChange={setChecked} />
            <p className="text-xs text-slate-500">
              No credentials yet? Request API access from PEAK first; see the{" "}
              <a
                className="text-brand underline"
                href="https://developers.peakaccount.com/reference/api-integration-guide"
                target="_blank"
                rel="noopener noreferrer"
              >
                API Integration Guide ↗
              </a>
              .
            </p>
            <div className="flex justify-between">
              {onExit ? (
                <Button variant="ghost" onClick={onExit}>
                  {settings.companies.length ? "Cancel" : "Skip for now"}
                </Button>
              ) : (
                <span />
              )}
              <Button disabled={!checked.every(Boolean)} onClick={() => setStep(1)}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">Developer credentials</h2>
              <p className="text-sm text-slate-500">
                Your application&apos;s Connect ID and Connect Key. Every company uses these unless you give it its own later. We check them by requesting a
                Client Token from PEAK.
              </p>
            </div>
            {settings.developer && !replaceDev ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-4 text-sm">
                  <EnvPill env={settings.developer.env} />
                  <span className="font-mono text-slate-700">{settings.developer.connectIdMasked}</span>
                  <StatusPill v={settings.developer.verified} />
                  <span className="text-slate-500">Already saved{settings.source === "env" ? " (from .env.local)" : ""}.</span>
                </div>
                <div className="flex justify-between">
                  <Button variant="ghost" onClick={() => setStep(0)}>
                    Back
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setReplaceDev(true)}>
                      Replace
                    </Button>
                    <Button onClick={() => setStep(2)}>Continue</Button>
                  </div>
                </div>
              </div>
            ) : (
              <DeveloperForm
                saved={settings.developer}
                saveLabel="Save and continue"
                onCancel={settings.developer ? () => setReplaceDev(false) : () => setStep(0)}
                onSaved={(s) => {
                  onChange(s);
                  setReplaceDev(false);
                  setStep(2);
                }}
              />
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">Connect a company</h2>
              <p className="text-sm text-slate-500">
                Each company (PEAK business) has its own User Token. Add the first one now; you can add more any time in Settings.
              </p>
            </div>
            {settings.companies.length > 0 && (
              <div className="rounded-xl border border-slate-200 p-3 text-sm text-slate-600">
                Already connected: <b>{settings.companies.map((c) => c.name).join(", ")}</b>.{" "}
                <button type="button" className="font-semibold text-brand underline" onClick={() => setStep(3)}>
                  Skip to finish
                </button>
              </div>
            )}
            <CompanyForm shared={settings.developer} saveLabel="Add and continue" onCancel={() => setStep(1)} onSaved={(s) => (onChange(s), setStep(3))} />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-green-100 text-2xl text-green-700">✓</div>
            <div>
              <h2 className="text-lg font-semibold">You&apos;re connected</h2>
              <p className="text-sm text-slate-500">
                {settings.companies.length} compan{settings.companies.length === 1 ? "y" : "ies"} ready. Each appears as a tab on the dashboard.
              </p>
            </div>
            <ul className="mx-auto max-w-md space-y-2 text-left">
              {settings.companies.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                  <span className="font-medium">{c.name}</span>
                  <span className="flex items-center gap-2">
                    <EnvPill env={c.env} />
                    <StatusPill v={c.verified} />
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" onClick={() => setStep(2)}>
                + Add another company
              </Button>
              <Link href="/" className="inline-flex items-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark">
                Open dashboard
              </Link>
            </div>
            {onExit && (
              <button type="button" onClick={onExit} className="text-sm text-slate-500 underline">
                Back to settings
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
