"use client";

import { useState } from "react";
import type { PeakEnvName, PublicCompany, PublicDeveloper, PublicSettings, TestResponse } from "@/lib/settings-types";
import { api, ApiError, isUatOpen, type DeveloperBody } from "./api";
import { Alert, Button, EnvPicker, Field, SecretInput, TestResultAlert, TextInput, Toggle } from "./ui";

// ---------- Developer credentials (Connect ID / Connect Key) ----------

function DeveloperFields({
  env,
  setEnv,
  connectId,
  setConnectId,
  connectKey,
  setConnectKey,
  saved,
}: {
  env: PeakEnvName;
  setEnv: (v: PeakEnvName) => void;
  connectId: string;
  setConnectId: (v: string) => void;
  connectKey: string;
  setConnectKey: (v: string) => void;
  saved: PublicDeveloper | null;
}) {
  return (
    <div className="space-y-4">
      <Field label="Environment">
        <EnvPicker value={env} onChange={setEnv} />
      </Field>
      {env === "uat" && !isUatOpen() && <Alert kind="warn">PEAK UAT may be offline right now (open Mon–Fri 08:00–22:00 Bangkok time). Tests may fail.</Alert>}
      <Field label="Connect ID" hint="From the ZIP in PEAK's API email.">
        <TextInput
          value={connectId}
          onChange={(e) => setConnectId(e.target.value)}
          placeholder={saved ? `Saved: ${saved.connectIdMasked} (leave blank to keep)` : "e.g. 0a1b2c3d-…"}
          className="font-mono"
        />
      </Field>
      <Field label="Connect Key" hint="Not the Application Code.">
        <SecretInput value={connectKey} onChange={setConnectKey} placeholder={saved?.hasConnectKey ? "Saved •••••• (leave blank to keep)" : "Connect Key"} />
      </Field>
    </div>
  );
}

/** Edits the shared developer credentials: Test, then Save (which tests again server-side). */
export function DeveloperForm({
  saved,
  onSaved,
  onCancel,
  saveLabel = "Save",
}: {
  saved: PublicDeveloper | null;
  onSaved: (s: PublicSettings) => void;
  onCancel?: () => void;
  saveLabel?: string;
}) {
  const [env, setEnv] = useState<PeakEnvName>(saved?.env ?? "uat");
  const [connectId, setConnectId] = useState("");
  const [connectKey, setConnectKey] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [result, setResult] = useState<TestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canForce, setCanForce] = useState(false);

  const body: DeveloperBody = { env, connectId: connectId.trim() || undefined, connectKey: connectKey.trim() || undefined };
  const reset = () => {
    setResult(null);
    setError(null);
    setCanForce(false);
  };

  const test = async () => {
    reset();
    setBusy("test");
    try {
      setResult(await api.testDeveloper(body));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = async (skipTest = false) => {
    reset();
    setBusy("save");
    try {
      const r = await api.saveDeveloper({ ...body, skipTest });
      onSaved(r.settings);
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "test_failed" && err.test) {
        setResult(err.test);
        setCanForce(true);
      } else setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onChange={reset}
    >
      <DeveloperFields
        env={env}
        setEnv={(v) => (setEnv(v), reset())}
        connectId={connectId}
        setConnectId={setConnectId}
        connectKey={connectKey}
        setConnectKey={setConnectKey}
        saved={saved}
      />
      {result && <TestResultAlert result={result} />}
      {error && <Alert kind="err">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="submit" loading={busy === "save"} disabled={busy !== null}>
          {saveLabel}
        </Button>
        <Button variant="secondary" onClick={test} loading={busy === "test"} disabled={busy !== null}>
          Test connection
        </Button>
        {canForce && (
          <Button variant="ghost" onClick={() => save(true)} disabled={busy !== null}>
            Save anyway
          </Button>
        )}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} className="ml-auto">
            Cancel
          </Button>
        )}
      </div>
      <p className="text-xs text-slate-500">PEAK allows 10 tests per minute.</p>
    </form>
  );
}

// ---------- Company (User Token, optionally its own developer credentials) ----------

const OWNER_STEPS = [
  "Log in to PEAK with the business you want to connect.",
  "Go to Settings > External system connection (ตั้งค่า > ตั้งค่าเชื่อมต่อระบบภายนอก).",
  "Enter the Application Code from the email “PEAK API UAT Application Code” (or the Production one).",
  "Review the consent page and accept the connection.",
  "Click Generate User Token. Copy it and send it back to the developer team securely.",
];

export function OwnerInstructions({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <details open={defaultOpen} className="group rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
      <summary className="cursor-pointer select-none text-sm font-semibold text-slate-800">How does the company get a User Token?</summary>
      <p className="mt-2 text-xs text-slate-600">
        A User Token opens <b>one</b> business in PEAK. Only that business&apos;s owner or admin can create it. Send them these steps:
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
        {OWNER_STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <Button
        variant="secondary"
        size="sm"
        className="mt-3"
        onClick={async () => {
          const text = `How to connect our dashboard to your PEAK account:\n\n${OWNER_STEPS.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nApplication Code: <paste Application Code here>`;
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied ✓" : "Copy instructions"}
      </Button>
    </details>
  );
}

export function CompanyForm({
  company,
  shared,
  onSaved,
  onCancel,
  saveLabel,
}: {
  /** Undefined = add a new company */
  company?: PublicCompany;
  shared: PublicDeveloper | null;
  onSaved: (s: PublicSettings) => void;
  onCancel?: () => void;
  saveLabel?: string;
}) {
  const editing = Boolean(company);
  const [name, setName] = useState(company?.name ?? "");
  const [userToken, setUserToken] = useState("");
  // Without shared developer credentials, a company must have its own.
  const [own, setOwn] = useState(Boolean(company?.ownDeveloper) || !shared);
  const [env, setEnv] = useState<PeakEnvName>(company?.ownDeveloper?.env ?? shared?.env ?? "uat");
  const [connectId, setConnectId] = useState("");
  const [connectKey, setConnectKey] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [result, setResult] = useState<TestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canForce, setCanForce] = useState(false);

  const reset = () => {
    setResult(null);
    setError(null);
    setCanForce(false);
  };
  const developer: DeveloperBody | null = own ? { env, connectId: connectId.trim() || undefined, connectKey: connectKey.trim() || undefined } : null;

  const test = async () => {
    reset();
    setBusy("test");
    try {
      const r = await api.testCompany({ id: company?.id, userToken: userToken.trim() || undefined, developer });
      setResult(r);
      // Suggest the PEAK business name when the name is still empty.
      if (r.ok && !name.trim() && r.business?.name) setName(r.business.name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = async (skipTest = false) => {
    reset();
    setBusy("save");
    try {
      const r = company
        ? await api.updateCompany(company.id, { name, userToken: userToken.trim() || undefined, developer, skipTest })
        : await api.addCompany({ name, userToken: userToken.trim(), developer: developer ?? undefined, skipTest });
      onSaved(r.settings);
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "test_failed" && err.test) {
        setResult(err.test);
        setCanForce(true);
      } else setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onChange={reset}
    >
      <Field label="Company name" hint="Shown as the dashboard tab.">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ThaiSunny" maxLength={40} />
      </Field>
      <Field
        label="User Token"
        hint={editing ? `Saved: ${company?.userTokenMasked}. Leave blank to keep it.` : "Created by the company's PEAK owner/admin from your Application Code."}
      >
        <SecretInput value={userToken} onChange={setUserToken} placeholder={editing ? "Leave blank to keep the saved token" : "Paste the User Token"} />
      </Field>
      <OwnerInstructions />

      <div className="rounded-xl border border-slate-200 p-4">
        <Toggle
          checked={own}
          onChange={(v) => {
            if (!shared && !v) return;
            setOwn(v);
            reset();
          }}
          label="Use this company's own developer credentials"
          hint={
            shared
              ? `Off: uses the shared developer credentials (${shared.env === "uat" ? "UAT" : "Production"}, ${shared.connectIdMasked}). Turn on if this company has its own PEAK API agreement.`
              : "No shared developer credentials are set up, so this company needs its own."
          }
        />
        {own && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <DeveloperFields
              env={env}
              setEnv={(v) => (setEnv(v), reset())}
              connectId={connectId}
              setConnectId={setConnectId}
              connectKey={connectKey}
              setConnectKey={setConnectKey}
              saved={company?.ownDeveloper ?? null}
            />
          </div>
        )}
      </div>

      {result && <TestResultAlert result={result} />}
      {error && <Alert kind="err">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="submit" loading={busy === "save"} disabled={busy !== null || !name.trim() || (!editing && !userToken.trim())}>
          {saveLabel ?? (editing ? "Save changes" : "Add company")}
        </Button>
        <Button variant="secondary" onClick={test} loading={busy === "test"} disabled={busy !== null || (!editing && !userToken.trim())}>
          Test connection
        </Button>
        {canForce && (
          <Button variant="ghost" onClick={() => save(true)} disabled={busy !== null}>
            Save anyway
          </Button>
        )}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} className="ml-auto">
            Cancel
          </Button>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Test shows which PEAK business this token opens.
      </p>
    </form>
  );
}
