import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

export type JobberTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId?: string;
  accountName?: string;
};

export type AutomationStatus = "draft" | "active" | "paused";
export type ApprovalPolicy = "always" | "preapproved";
export type AutomationTrigger =
  | { type: "manual" }
  | { type: "interval"; everyMinutes: number };
export type AutomationAction =
  | { type: "log.message"; message: string }
  | { type: "jobber.query"; query: string; variables?: Record<string, unknown> }
  | { type: "jobber.mutation"; mutation: string; variables?: Record<string, unknown> };

export type Automation = {
  id: string;
  name: string;
  description: string;
  status: AutomationStatus;
  approvalPolicy: ApprovalPolicy;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type AutomationRun = {
  id: string;
  automationId: string;
  status: "running" | "previewed" | "succeeded" | "failed" | "blocked";
  source: "manual" | "scheduler" | "preview";
  startedAt: number;
  finishedAt: number | null;
  output: unknown;
  error: string | null;
};

const databasePath = resolve(config.DATABASE_PATH);
mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(databasePath);
chmodSync(databasePath, 0o600);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS oauth_states (
    state_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    event_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS automations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'paused')),
    approval_policy TEXT NOT NULL CHECK(approval_policy IN ('always', 'preapproved')),
    trigger_json TEXT NOT NULL,
    actions_json TEXT NOT NULL,
    next_run_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS automation_runs (
    id TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    output_json TEXT,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_automations_due ON automations(status, next_run_at);
  CREATE INDEX IF NOT EXISTS idx_runs_automation ON automation_runs(automation_id, started_at DESC);
`);

const parseJson = <T>(value: unknown): T => JSON.parse(String(value)) as T;

export async function getTokens(): Promise<JobberTokens | null> {
  const row = db.prepare("SELECT value_json FROM settings WHERE key = ?").get("jobber_tokens") as { value_json: string } | undefined;
  return row ? parseJson<JobberTokens>(row.value_json) : null;
}

export async function saveTokens(tokens: JobberTokens): Promise<void> {
  db.prepare(`INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
    .run("jobber_tokens", JSON.stringify(tokens), Date.now());
}

export async function createOAuthState(stateHash: string): Promise<void> {
  db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").run(Date.now());
  db.prepare("INSERT INTO oauth_states(state_hash, expires_at) VALUES (?, ?)")
    .run(stateHash, Date.now() + 10 * 60_000);
}

export async function consumeOAuthState(stateHash: string): Promise<boolean> {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT expires_at FROM oauth_states WHERE state_hash = ?").get(stateHash) as { expires_at: number } | undefined;
    db.prepare("DELETE FROM oauth_states WHERE state_hash = ?").run(stateHash);
    db.exec("COMMIT");
    return Boolean(row && row.expires_at >= Date.now());
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function writeAudit(entry: Record<string, unknown>): Promise<void> {
  db.prepare("INSERT INTO audit_events(id, event_json, created_at) VALUES (?, ?, ?)")
    .run(randomUUID(), JSON.stringify(entry), Date.now());
}

function automationFromRow(row: Record<string, unknown>): Automation {
  return {
    id: String(row.id), name: String(row.name), description: String(row.description),
    status: row.status as AutomationStatus, approvalPolicy: row.approval_policy as ApprovalPolicy,
    trigger: parseJson<AutomationTrigger>(row.trigger_json), actions: parseJson<AutomationAction[]>(row.actions_json),
    nextRunAt: row.next_run_at == null ? null : Number(row.next_run_at),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at)
  };
}

export function createAutomation(input: Omit<Automation, "id" | "createdAt" | "updatedAt" | "nextRunAt">): Automation {
  const now = Date.now();
  const automation: Automation = { ...input, id: randomUUID(), createdAt: now, updatedAt: now, nextRunAt: null };
  db.prepare(`INSERT INTO automations
    (id, name, description, status, approval_policy, trigger_json, actions_json, next_run_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(automation.id, automation.name, automation.description, automation.status, automation.approvalPolicy,
      JSON.stringify(automation.trigger), JSON.stringify(automation.actions), null, now, now);
  return automation;
}

export function getAutomation(id: string): Automation | null {
  const row = db.prepare("SELECT * FROM automations WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? automationFromRow(row) : null;
}

export function listAutomations(): Automation[] {
  return (db.prepare("SELECT * FROM automations ORDER BY created_at DESC").all() as Record<string, unknown>[]).map(automationFromRow);
}

export function updateAutomation(id: string, patch: Partial<Pick<Automation, "name" | "description" | "status" | "approvalPolicy" | "trigger" | "actions" | "nextRunAt">>): Automation | null {
  const current = getAutomation(id);
  if (!current) return null;
  const next = { ...current, ...patch, updatedAt: Date.now() };
  db.prepare(`UPDATE automations SET name = ?, description = ?, status = ?, approval_policy = ?,
    trigger_json = ?, actions_json = ?, next_run_at = ?, updated_at = ? WHERE id = ?`)
    .run(next.name, next.description, next.status, next.approvalPolicy, JSON.stringify(next.trigger),
      JSON.stringify(next.actions), next.nextRunAt, next.updatedAt, id);
  return next;
}

export function deleteAutomation(id: string): boolean {
  return db.prepare("DELETE FROM automations WHERE id = ?").run(id).changes > 0;
}

export function createAutomationRun(automationId: string, source: AutomationRun["source"]): AutomationRun {
  const run: AutomationRun = { id: randomUUID(), automationId, source, status: "running", startedAt: Date.now(), finishedAt: null, output: null, error: null };
  db.prepare(`INSERT INTO automation_runs(id, automation_id, status, source, started_at, finished_at, output_json, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(run.id, run.automationId, run.status, run.source, run.startedAt, null, null, null);
  return run;
}

export function finishAutomationRun(id: string, status: AutomationRun["status"], output: unknown, error: string | null): void {
  db.prepare("UPDATE automation_runs SET status = ?, finished_at = ?, output_json = ?, error = ? WHERE id = ?")
    .run(status, Date.now(), output === undefined ? null : JSON.stringify(output), error, id);
}

export function listAutomationRuns(automationId: string, limit = 25): AutomationRun[] {
  const rows = db.prepare("SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY started_at DESC LIMIT ?")
    .all(automationId, limit) as Record<string, unknown>[];
  return rows.map(row => ({
    id: String(row.id), automationId: String(row.automation_id), status: row.status as AutomationRun["status"],
    source: row.source as AutomationRun["source"], startedAt: Number(row.started_at),
    finishedAt: row.finished_at == null ? null : Number(row.finished_at),
    output: row.output_json == null ? null : parseJson(row.output_json), error: row.error == null ? null : String(row.error)
  }));
}

export function listDueAutomations(now = Date.now()): Automation[] {
  return (db.prepare("SELECT * FROM automations WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at").all(now) as Record<string, unknown>[]).map(automationFromRow);
}

export function closeDatabase(): void {
  db.close();
}
