"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { NS_DEFAULT_SCRIPT, nsKind, type NsKind, type PublicNetSuite, type PublicSettings, type TestResponse } from "@/lib/settings-types";
import { api, ApiError, type NetSuiteBody } from "./api";
import { Alert, Button, Card, Checklist, Chip, Field, Modal, SecretInput, StatusPill, Stepper, TestResultAlert, TextInput } from "./ui";

// NetSuite connections use OAuth 1.0 Token-Based Authentication (TBA) against SCG's integration RESTlet
// (netsuite_api_docs/). Each connection = one NetSuite account + one integration record + one access token.

// ---------- Small pieces ----------

export function NsKindPill({ kind }: { kind: NsKind }) {
  return kind === "sandbox" ? (
    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800">Sandbox</span>
  ) : (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Production</span>
  );
}

function NetSuiteMark() {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#1f3b57] text-[11px] font-black tracking-tight text-white" aria-hidden>
      NS
    </span>
  );
}

const hostFor = (accountId: string) => `${(accountId || "<account>").toLowerCase().replace(/_/g, "-")}.restlets.api.netsuite.com`;

type EnvChoice = "prod" | "sb1" | "sb2" | "other";

const ENV_OPTIONS: { key: EnvChoice; label: string; note: string }[] = [
  { key: "prod", label: "Production", note: "Live data. Account ID is the plain number." },
  { key: "sb1", label: "Sandbox 1", note: "Account ID ends in _SB1." },
  { key: "sb2", label: "Sandbox 2", note: "Account ID ends in _SB2." },
  { key: "other", label: "Other", note: "Type the full Account ID." },
];

// No preselected environment: picking the wrong one silently points at another (or a non-existent) account.
function splitAccount(accountId: string | undefined): { env: EnvChoice | null; base: string; other: string } {
  if (!accountId) return { env: null, base: "", other: "" };
  const m = /^([0-9A-Z]+?)(?:_(SB1|SB2))?$/.exec(accountId);
  if (m && /^\d+$/.test(m[1])) return { env: m[2] ? (m[2].toLowerCase() as EnvChoice) : "prod", base: m[1], other: "" };
  return { env: "other", base: "", other: accountId };
}

function joinAccount(env: EnvChoice | null, base: string, other: string): string {
  if (!env) return "";
  if (env === "other") return other.trim().toUpperCase().replace(/-/g, "_");
  const b = base.trim();
  if (!b) return "";
  return env === "prod" ? b : `${b}_${env.toUpperCase()}`;
}

// ---------- Field groups (shared by the setup guide and the edit form) ----------

interface AccountState {
  env: EnvChoice | null;
  base: string;
  other: string;
  scriptId: string;
  deployId: string;
}

type HostCheck = { account: string; host: string; found: boolean | null; code: string | null } | null;

/** Checks (DNS only, nothing sent to NetSuite) that the RESTlet host for this Account ID exists. */
function useHostCheck(accountId: string): HostCheck | "checking" {
  const [check, setCheck] = useState<HostCheck>(null);
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .resolveNetSuite(accountId)
        .then((r) => !cancelled && setCheck({ account: accountId, ...r }))
        .catch(() => !cancelled && setCheck({ account: accountId, host: "", found: null, code: "ERROR" }));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [accountId]);
  if (!accountId) return null;
  return check?.account === accountId ? check : "checking";
}

function AccountFields({ v, set }: { v: AccountState; set: (p: Partial<AccountState>) => void }) {
  const accountId = joinAccount(v.env, v.base, v.other);
  const check = useHostCheck(accountId);
  return (
    <div className="space-y-4">
      <Field label="Environment">
        <div className="grid gap-2 sm:grid-cols-4" role="radiogroup">
          {ENV_OPTIONS.map((o) => {
            const on = v.env === o.key;
            return (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ env: o.key })}
                className={`rounded-xl border p-3 text-left transition ${on ? "border-brand bg-brand-soft/60 ring-4 ring-brand/10" : "border-slate-200 bg-white hover:border-slate-300"}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`flex size-4 items-center justify-center rounded-full border-2 ${on ? "border-brand" : "border-slate-300"}`}>
                    {on && <span className="size-2 rounded-full bg-brand" />}
                  </span>
                  <span className="text-sm font-semibold">{o.label}</span>
                </div>
                <div className="mt-1 pl-6 text-xs text-slate-500">{o.note}</div>
              </button>
            );
          })}
        </div>
      </Field>

      {v.env === "other" ? (
        <Field label="Account ID" hint="e.g. 1234567_SB3">
          <TextInput value={v.other} onChange={(e) => set({ other: e.target.value })} placeholder="1234567_SB3" className="font-mono" />
        </Field>
      ) : (
        <Field label="Account number" hint="Company ID without the sandbox suffix.">
          <TextInput
            value={v.base}
            onChange={(e) => set({ base: e.target.value.replace(/\D/g, "") })}
            placeholder="1234567"
            inputMode="numeric"
            className="font-mono"
          />
        </Field>
      )}

      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <div>
          Realm: <span className="font-mono text-slate-800">{accountId || "—"}</span>
        </div>
        <div className="truncate">
          RESTlet:{" "}
          <span className="font-mono text-slate-800">
            https://{hostFor(accountId)}/app/site/hosting/restlet.nl?script={v.scriptId || NS_DEFAULT_SCRIPT}&deploy={v.deployId || "1"}
          </span>
        </div>
        {check && (
          <div className="mt-1" role="status">
            {check === "checking" ? (
              <span className="text-slate-500">Checking the host…</span>
            ) : check.found ? (
              <span className="font-medium text-green-700">✓ Host found</span>
            ) : check.found === false ? (
              <span className="font-medium text-red-700">
                ✕ This host doesn&apos;t exist, so no request can reach it. Check the environment and account number (compare with the account_id that works in
                Postman).
              </span>
            ) : (
              <span className="text-amber-700">⚠ Couldn&apos;t check the host ({check.code}). The connection test will tell.</span>
            )}
          </div>
        )}
      </div>

      <details className="rounded-xl border border-slate-200 px-4 py-3">
        <summary className="cursor-pointer select-none text-sm font-medium text-slate-700">Advanced: RESTlet script</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Script ID" hint="Usually customscript_int_api_2.">
            <TextInput value={v.scriptId} onChange={(e) => set({ scriptId: e.target.value })} placeholder={NS_DEFAULT_SCRIPT} className="font-mono" />
          </Field>
          <Field label="Deployment ID">
            <TextInput value={v.deployId} onChange={(e) => set({ deployId: e.target.value })} placeholder="1" className="font-mono" />
          </Field>
        </div>
      </details>
    </div>
  );
}

interface KeyState {
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
}

function KeyFields({ v, set, saved }: { v: KeyState; set: (p: Partial<KeyState>) => void; saved?: PublicNetSuite }) {
  const keep = saved ? " (leave blank to keep)" : "";
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Integration record (the application)</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Consumer Key" hint={saved ? `Saved: ${saved.consumerKeyMasked}` : "Shown once when the integration record is saved."}>
            <SecretInput value={v.consumerKey} onChange={(x) => set({ consumerKey: x })} placeholder={`Consumer Key${keep}`} />
          </Field>
          <Field label="Consumer Secret">
            <SecretInput value={v.consumerSecret} onChange={(x) => set({ consumerSecret: x })} placeholder={saved ? "Saved ••••••" + keep : "Consumer Secret"} />
          </Field>
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Access token (user + role)</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Token ID" hint={saved ? `Saved: ${saved.tokenIdMasked}` : "Shown once when the access token is created."}>
            <SecretInput value={v.tokenId} onChange={(x) => set({ tokenId: x })} placeholder={`Token ID${keep}`} />
          </Field>
          <Field label="Token Secret">
            <SecretInput value={v.tokenSecret} onChange={(x) => set({ tokenSecret: x })} placeholder={saved ? "Saved ••••••" + keep : "Token Secret"} />
          </Field>
        </div>
      </div>
    </div>
  );
}

const ADMIN_STEPS = [
  "Setup > Company > Enable Features > SuiteCloud: turn on Token-Based Authentication, REST Web Services and Server SuiteScript.",
  "Setup > Integration > Manage Integrations > New: name it (e.g. “Executive Dashboard”), tick Token-Based Authentication, untick the Authorization Code Grant / TBA Authorization Flow. Save, then copy the Consumer Key and Consumer Secret (shown only once).",
  "Use a role with “Log in using Access Tokens” and permission to run the integration RESTlet (customscript_int_api). Read-only is enough for the dashboard.",
  "Setup > Users/Roles > Access Tokens > New: pick that application, the integration user and that role. Save, then copy the Token ID and Token Secret (shown only once).",
  "Send the four values and the Account ID to the dashboard team through a secure channel (not plain email or chat).",
];

export function NsAdminInstructions({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <details open={defaultOpen} className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
      <summary className="cursor-pointer select-none text-sm font-semibold text-slate-800">How does the NetSuite admin create these?</summary>
      <p className="mt-2 text-xs text-slate-600">
        For <b>Production</b>, the doc says to contact the NetSuite system administrator. Send them these steps:
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
        {ADMIN_STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <Button
        variant="secondary"
        size="sm"
        className="mt-3"
        onClick={async () => {
          const text = `Please set up NetSuite access for the executive dashboard (OAuth 1.0 Token-Based Authentication):\n\n${ADMIN_STEPS.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
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

// ---------- Shared test/save logic ----------

function useTestSave(existing?: PublicNetSuite) {
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [result, setResult] = useState<TestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canForce, setCanForce] = useState(false);
  const reset = () => {
    setResult(null);
    setError(null);
    setCanForce(false);
  };
  const test = async (body: NetSuiteBody) => {
    reset();
    setBusy("test");
    try {
      setResult(await api.testNetSuite({ ...body, id: existing?.id }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const save = async (body: NetSuiteBody & { name: string }, skipTest: boolean): Promise<{ settings: PublicSettings; test: TestResponse | null } | null> => {
    reset();
    setBusy("save");
    try {
      return existing ? await api.updateNetSuite(existing.id, { ...body, skipTest }) : await api.addNetSuite({ ...body, skipTest });
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "test_failed" && err.test) {
        setResult(err.test);
        setCanForce(true);
      } else setError(err.message);
      return null;
    } finally {
      setBusy(null);
    }
  };
  return { busy, result, error, canForce, reset, test, save };
}

const blankKeys: KeyState = { consumerKey: "", consumerSecret: "", tokenId: "", tokenSecret: "" };

function bodyFrom(acc: AccountState, keys: KeyState): NetSuiteBody {
  const t = (s: string) => s.trim() || undefined;
  return {
    accountId: joinAccount(acc.env, acc.base, acc.other) || undefined,
    consumerKey: t(keys.consumerKey),
    consumerSecret: t(keys.consumerSecret),
    tokenId: t(keys.tokenId),
    tokenSecret: t(keys.tokenSecret),
    scriptId: t(acc.scriptId),
    deployId: t(acc.deployId),
  };
}

function initialAccount(n?: PublicNetSuite): AccountState {
  return { ...splitAccount(n?.accountId), scriptId: n?.scriptId ?? NS_DEFAULT_SCRIPT, deployId: n?.deployId ?? "1" };
}

const TEST_NOTE = (
  <p className="text-xs text-slate-500">
    Test only reads from NetSuite.
  </p>
);

// ---------- Setup guide ----------

const STEPS = ["Get started", "Account", "Access keys", "Done"];

const CHECKLIST: ReactNode[] = [
  <>
    SCG&apos;s NetSuite team has deployed the integration RESTlet <b>customscript_int_api</b> on the account you want to connect.
  </>,
  <>
    A NetSuite admin created an <b>integration record</b> with Token-Based Authentication, and I have its <b>Consumer Key</b> and <b>Consumer Secret</b>.
  </>,
  <>
    The admin created an <b>access token</b> for an integration user and role, and I have the <b>Token ID</b> and <b>Token Secret</b>.
  </>,
  <>
    I know the <b>Account ID</b> (NetSuite Company ID), e.g. <span className="font-mono">1234567</span> or <span className="font-mono">1234567_SB1</span>.
  </>,
];

export function NetSuiteOnboarding({ onChange, onExit }: { onChange: (s: PublicSettings) => void; onExit?: () => void }) {
  const [step, setStep] = useState(0);
  const [checked, setChecked] = useState(() => CHECKLIST.map(() => false));
  const [name, setName] = useState("");
  const [acc, setAcc] = useState<AccountState>(() => initialAccount());
  const [keys, setKeys] = useState<KeyState>(blankKeys);
  const [added, setAdded] = useState<{ name: string; test: TestResponse | null } | null>(null);
  const ts = useTestSave();

  const accountId = joinAccount(acc.env, acc.base, acc.other);
  const keysComplete = Object.values(keys).every((x) => x.trim());
  const setA = (p: Partial<AccountState>) => (setAcc((s) => ({ ...s, ...p })), ts.reset());
  const setK = (p: Partial<KeyState>) => (setKeys((s) => ({ ...s, ...p })), ts.reset());

  const save = async (skipTest: boolean) => {
    const r = await ts.save({ ...bodyFrom(acc, keys), name }, skipTest);
    if (r) {
      onChange(r.settings);
      setAdded({ name, test: r.test });
      setKeys(blankKeys); // don't keep secrets in browser memory longer than needed
      setStep(3);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold tracking-tight">Connect NetSuite</h2>
        <p className="mt-1 text-sm text-slate-500">OAuth 1.0 Token-Based Authentication. The keys are saved on this server only.</p>
      </div>
      <Stepper steps={STEPS} step={step} />

      <div className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
        {step === 0 && (
          <div className="space-y-5">
            <div>
              <h3 className="text-lg font-semibold">Before you start</h3>
              <p className="text-sm text-slate-500">NetSuite uses five values. A NetSuite administrator creates them; tick each one you have.</p>
            </div>
            <Checklist items={CHECKLIST} checked={checked} onChange={setChecked} />
            <NsAdminInstructions />
            <div className="flex justify-between">
              {onExit ? (
                <Button variant="ghost" onClick={onExit}>
                  Cancel
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
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              setStep(2);
            }}
          >
            <div>
              <h3 className="text-lg font-semibold">Which NetSuite account?</h3>
              <p className="text-sm text-slate-500">Sandbox and Production are separate accounts with separate keys.</p>
            </div>
            <Field label="Connection name" hint="e.g. the business unit">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SCG NetSuite Sandbox" maxLength={40} />
            </Field>
            <AccountFields v={acc} set={setA} />
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button type="submit" disabled={!name.trim() || !accountId}>
                Continue
              </Button>
            </div>
          </form>
        )}

        {step === 2 && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void save(false);
            }}
          >
            <div>
              <h3 className="text-lg font-semibold">Access keys</h3>
              <p className="text-sm text-slate-500">
                Paste the four values for <span className="font-mono">{accountId}</span>. They sign every request (HMAC-SHA256) and are never sent to the browser
                again.
              </p>
            </div>
            <KeyFields v={keys} set={setK} />
            {ts.result && <TestResultAlert result={ts.result} />}
            {ts.error && <Alert kind="err">{ts.error}</Alert>}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => ts.test(bodyFrom(acc, keys))} loading={ts.busy === "test"} disabled={ts.busy !== null || !keysComplete}>
                  Test connection
                </Button>
                {ts.canForce && (
                  <Button variant="ghost" onClick={() => save(true)} disabled={ts.busy !== null}>
                    Save anyway
                  </Button>
                )}
                <Button type="submit" loading={ts.busy === "save"} disabled={ts.busy !== null || !keysComplete}>
                  Test and save
                </Button>
              </div>
            </div>
            {TEST_NOTE}
          </form>
        )}

        {step === 3 && added && (
          <div className="space-y-5 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-green-100 text-2xl text-green-700">✓</div>
            <div>
              <h3 className="text-lg font-semibold">“{added.name}” is saved</h3>
              <p className="text-sm text-slate-500">
                {added.test ? "The connection test passed." : "Saved without a passing test. Use Test in Settings once NetSuite access is ready."}
              </p>
            </div>
            {added.test && (
              <div className="mx-auto max-w-lg text-left">
                <TestResultAlert result={added.test} />
              </div>
            )}
            <Alert kind="info">
              “{added.name}” is now a tab on the dashboard (marked NS). Its AR comes from endpoint #46 <code>invoicefromso_lhs</code>: due date, status and
              remaining amount per invoice.
            </Alert>
            <div className="flex flex-wrap justify-center gap-2">
              {onExit && (
                <Button variant="secondary" onClick={onExit}>
                  Back to NetSuite settings
                </Button>
              )}
              <Link href="/" className="inline-flex items-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark">
                Open dashboard
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Edit form (modal) ----------

function NetSuiteEditForm({ connection, onSaved, onCancel }: { connection: PublicNetSuite; onSaved: (s: PublicSettings) => void; onCancel: () => void }) {
  const [name, setName] = useState(connection.name);
  const [acc, setAcc] = useState<AccountState>(() => initialAccount(connection));
  const [keys, setKeys] = useState<KeyState>(blankKeys);
  const ts = useTestSave(connection);
  const setA = (p: Partial<AccountState>) => (setAcc((s) => ({ ...s, ...p })), ts.reset());
  const setK = (p: Partial<KeyState>) => (setKeys((s) => ({ ...s, ...p })), ts.reset());
  const accountId = joinAccount(acc.env, acc.base, acc.other);

  const save = async (skipTest: boolean) => {
    const r = await ts.save({ ...bodyFrom(acc, keys), name }, skipTest);
    if (r) onSaved(r.settings);
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      <Field label="Connection name">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
      </Field>
      <AccountFields v={acc} set={setA} />
      <KeyFields v={keys} set={setK} saved={connection} />
      {ts.result && <TestResultAlert result={ts.result} />}
      {ts.error && <Alert kind="err">{ts.error}</Alert>}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="submit" loading={ts.busy === "save"} disabled={ts.busy !== null || !name.trim() || !accountId}>
          Save changes
        </Button>
        <Button variant="secondary" onClick={() => ts.test(bodyFrom(acc, keys))} loading={ts.busy === "test"} disabled={ts.busy !== null || !accountId}>
          Test connection
        </Button>
        {ts.canForce && (
          <Button variant="ghost" onClick={() => save(true)} disabled={ts.busy !== null}>
            Save anyway
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel} className="ml-auto">
          Cancel
        </Button>
      </div>
      {TEST_NOTE}
    </form>
  );
}

// ---------- Settings section ----------

export function NetSuiteSection({ settings, onChange }: { settings: PublicSettings; onChange: (s: PublicSettings) => void }) {
  const [wizard, setWizard] = useState(false);
  const [editing, setEditing] = useState<PublicNetSuite | null>(null);

  if (wizard) return <NetSuiteOnboarding onChange={onChange} onExit={() => setWizard(false)} />;

  return (
    <Card
      title="NetSuite"
      description="Each connection is a tab on the dashboard."
      action={settings.netsuite.length > 0 && <Button onClick={() => setWizard(true)}>+ Connect NetSuite</Button>}
    >
      {settings.netsuite.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center">
          <div className="mx-auto mb-3 w-fit">
            <NetSuiteMark />
          </div>
          <p className="text-sm font-medium text-slate-800">No NetSuite account connected</p>
          <Button className="mt-4" onClick={() => setWizard(true)}>
            Start NetSuite setup
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {settings.netsuite.map((n) => (
            <NetSuiteRow key={n.id} n={n} onEdit={() => setEditing(n)} onChange={onChange} />
          ))}
        </ul>
      )}

      {editing && (
        <Modal title={`Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <NetSuiteEditForm
            connection={editing}
            onCancel={() => setEditing(null)}
            onSaved={(s) => {
              onChange(s);
              setEditing(null);
            }}
          />
        </Modal>
      )}
    </Card>
  );
}

function NetSuiteRow({ n, onEdit, onChange }: { n: PublicNetSuite; onEdit: () => void; onChange: (s: PublicSettings) => void }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResponse | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm">
      <div className="flex flex-wrap items-center gap-4">
        <NetSuiteMark />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{n.name}</span>
            <NsKindPill kind={n.kind ?? nsKind(n.accountId)} />
            <StatusPill v={n.verified} />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-slate-500">
            <Chip k="Account" mono>
              {n.accountId}
            </Chip>
            <Chip k="Consumer Key" mono>
              {n.consumerKeyMasked}
            </Chip>
            <Chip k="Token" mono>
              {n.tokenIdMasked}
            </Chip>
            <Chip k="Script" mono>
              {n.scriptId}/{n.deployId}
            </Chip>
          </div>
        </div>
        {confirmDelete ? (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-900">
            Remove {n.name}?
            <Button
              variant="danger"
              size="sm"
              loading={deleting}
              onClick={async () => {
                setDeleting(true);
                try {
                  onChange((await api.deleteNetSuite(n.id)).settings);
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
            <Button
              variant="secondary"
              size="sm"
              loading={testing}
              onClick={async () => {
                setTesting(true);
                setResult(null);
                setError(null);
                try {
                  setResult(await api.testNetSuite({ id: n.id }));
                  onChange(await api.settings());
                } catch (e) {
                  setResult({ ok: false, message: (e as Error).message });
                } finally {
                  setTesting(false);
                }
              }}
            >
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
