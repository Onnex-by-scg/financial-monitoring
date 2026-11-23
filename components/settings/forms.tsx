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
      {env === "uat" && !isUatOpen() && <Alert kind="warn">PEAK UAT is closed right now, so tests may fail.</Alert>}
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
  cancelLabel = "Cancel",
}: {
  saved: PublicDeveloper | null;
  onSaved: (s: PublicSettings) => void;
  onCancel?: () => void;
  saveLabel?: string;
  cancelLabel?: string;
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
      <FormActions
        onCancel={onCancel}
        cancelLabel={cancelLabel}
        busy={busy}
        canForce={canForce}
        onForce={() => save(true)}
        onTest={test}
        testTitle="PEAK allows 10 tests a minute"
        saveLabel={saveLabel}
      />
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
    <details open={defaultOpen} className="group rounded-xl bg-slate-50 px-4 py-3">
      <summary className="cursor-pointer select-none text-sm font-medium text-slate-700">How the owner creates a User Token</summary>
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
        {copied ? "Copied" : "Copy instructions"}
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
  cancelLabel = "Cancel",
}: {
  /** Undefined = add a new company */
  company?: PublicCompany;
  shared: PublicDeveloper | null;
  onSaved: (s: PublicSettings) => void;
  onCancel?: () => void;
  saveLabel?: string;
  cancelLabel?: string;
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
      <Field label="Company name">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ThaiSunny" maxLength={40} />
      </Field>
      <Field
        label="User Token"
        hint={editing ? `Saved: ${company?.userTokenMasked}` : undefined}
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
          label="Own developer credentials"
          hint={shared ? `Off: shared (${shared.env === "uat" ? "UAT" : "Production"}, ${shared.connectIdMasked}).` : "Required: no shared credentials yet."}
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
      <FormActions
        onCancel={onCancel}
        cancelLabel={cancelLabel}
        busy={busy}
        canForce={canForce}
        onForce={() => save(true)}
        onTest={test}
        testDisabled={!editing && !userToken.trim()}
        testTitle="Shows which PEAK business this token opens"
        saveLabel={saveLabel ?? (editing ? "Save changes" : "Add company")}
        saveDisabled={!name.trim() || (!editing && !userToken.trim())}
      />
    </form>
  );
}

/** The bottom row of a credentials form: Cancel/Back on the left; Save anyway, Test, Save on the right. */
export function FormActions({
  onCancel,
  cancelLabel = "Cancel",
  busy,
  canForce,
  onForce,
  onTest,
  testDisabled,
  testTitle,
  saveLabel,
  saveDisabled,
}: {
  onCancel?: () => void;
  cancelLabel?: string;
  busy: "test" | "save" | null;
  canForce: boolean;
  onForce: () => void;
  onTest: () => void;
  testDisabled?: boolean;
  testTitle?: string;
  saveLabel: string;
  saveDisabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-5">
      {onCancel && (
        <Button variant="ghost" onClick={onCancel}>
          {cancelLabel}
        </Button>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {canForce && (
          <Button variant="ghost" onClick={onForce} disabled={busy !== null}>
            Save anyway
          </Button>
        )}
        <Button variant="secondary" onClick={onTest} loading={busy === "test"} disabled={busy !== null || testDisabled} title={testTitle}>
          Test
        </Button>
        <Button type="submit" loading={busy === "save"} disabled={busy !== null || saveDisabled}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
