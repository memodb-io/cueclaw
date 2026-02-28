import Database from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { cueclawHome } from './config.js'
import type { Workflow, WorkflowRun, StepRun, WorkflowPhase } from './types.js'

// ─── Schema ───

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workflows (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  trigger_json  TEXT NOT NULL,
  steps_json    TEXT NOT NULL,
  failure_policy_json TEXT NOT NULL,
  phase         TEXT NOT NULL DEFAULT 'planning',
  schema_version TEXT NOT NULL DEFAULT '1.0',
  metadata_json TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id            TEXT PRIMARY KEY,
  workflow_id   TEXT NOT NULL REFERENCES workflows(id),
  trigger_data  TEXT,
  status        TEXT NOT NULL DEFAULT 'running',
  started_at    TEXT NOT NULL,
  completed_at  TEXT,
  error         TEXT,
  duration_ms   INTEGER
);

CREATE TABLE IF NOT EXISTS step_runs (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES workflow_runs(id),
  step_id       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  output_json   TEXT,
  error         TEXT,
  started_at    TEXT,
  completed_at  TEXT,
  duration_ms   INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  step_run_id   TEXT NOT NULL REFERENCES step_runs(id),
  sdk_session_id TEXT,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS trigger_state (
  workflow_id   TEXT PRIMARY KEY REFERENCES workflows(id),
  last_result   TEXT,
  last_check_at TEXT,
  last_fire_at  TEXT,
  last_error    TEXT
);

CREATE INDEX IF NOT EXISTS idx_workflows_phase ON workflows(phase);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id ON workflow_runs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_step_runs_run_id ON step_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_step_runs_step_run ON step_runs(step_id, run_id);
CREATE INDEX IF NOT EXISTS idx_sessions_step_run_id ON sessions(step_run_id);
`

// ─── Init ───

export function initDb(dbPath?: string): Database.Database {
  const path = dbPath ?? join(cueclawHome(), 'db', 'cueclaw.db')
  mkdirSync(join(path, '..'), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

/** @internal — for tests only */
export function _initTestDatabase(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

function runMigrations(db: Database.Database): void {
  db.exec(SCHEMA)
}

// ─── CRUD: Workflows ───

interface WorkflowRow {
  id: string
  name: string
  description: string
  trigger_json: string
  steps_json: string
  failure_policy_json: string
  phase: string
  schema_version: string
  metadata_json: string | null
  created_at: string
  updated_at: string
}

function rowToWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    trigger: JSON.parse(row.trigger_json),
    steps: JSON.parse(row.steps_json),
    failure_policy: JSON.parse(row.failure_policy_json),
    phase: row.phase as WorkflowPhase,
    schema_version: row.schema_version as '1.0',
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export function insertWorkflow(db: Database.Database, workflow: Workflow): void {
  db.prepare(`
    INSERT INTO workflows (id, name, description, trigger_json, steps_json, failure_policy_json, phase, schema_version, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workflow.id,
    workflow.name,
    workflow.description,
    JSON.stringify(workflow.trigger),
    JSON.stringify(workflow.steps),
    JSON.stringify(workflow.failure_policy),
    workflow.phase,
    workflow.schema_version,
    workflow.metadata ? JSON.stringify(workflow.metadata) : null,
    workflow.created_at,
    workflow.updated_at,
  )
}

export function upsertWorkflow(db: Database.Database, workflow: Workflow): void {
  db.prepare(`
    INSERT OR REPLACE INTO workflows (id, name, description, trigger_json, steps_json, failure_policy_json, phase, schema_version, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workflow.id,
    workflow.name,
    workflow.description,
    JSON.stringify(workflow.trigger),
    JSON.stringify(workflow.steps),
    JSON.stringify(workflow.failure_policy),
    workflow.phase,
    workflow.schema_version,
    workflow.metadata ? JSON.stringify(workflow.metadata) : null,
    workflow.created_at,
    workflow.updated_at,
  )
}

export function getWorkflow(db: Database.Database, id: string): Workflow | undefined {
  const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as WorkflowRow | undefined
  return row ? rowToWorkflow(row) : undefined
}

export function listWorkflows(db: Database.Database, phase?: WorkflowPhase): Workflow[] {
  const query = phase
    ? db.prepare('SELECT * FROM workflows WHERE phase = ? ORDER BY updated_at DESC')
    : db.prepare('SELECT * FROM workflows ORDER BY updated_at DESC')
  const rows = (phase ? query.all(phase) : query.all()) as WorkflowRow[]
  return rows.map(rowToWorkflow)
}

export function updateWorkflowPhase(db: Database.Database, id: string, phase: WorkflowPhase): void {
  db.prepare('UPDATE workflows SET phase = ?, updated_at = ? WHERE id = ?')
    .run(phase, new Date().toISOString(), id)
}

export function deleteWorkflow(db: Database.Database, id: string): void {
  const del = db.transaction(() => {
    // Delete in FK dependency order: sessions → step_runs → workflow_runs → trigger_state → workflows
    const runIds = db.prepare('SELECT id FROM workflow_runs WHERE workflow_id = ?').all(id) as { id: string }[]
    for (const run of runIds) {
      const stepRunIds = db.prepare('SELECT id FROM step_runs WHERE run_id = ?').all(run.id) as { id: string }[]
      for (const sr of stepRunIds) {
        db.prepare('DELETE FROM sessions WHERE step_run_id = ?').run(sr.id)
      }
      db.prepare('DELETE FROM step_runs WHERE run_id = ?').run(run.id)
    }
    db.prepare('DELETE FROM workflow_runs WHERE workflow_id = ?').run(id)
    db.prepare('DELETE FROM trigger_state WHERE workflow_id = ?').run(id)
    db.prepare('DELETE FROM workflows WHERE id = ?').run(id)
  })
  del()
}

// ─── CRUD: Workflow Runs ───

export function insertWorkflowRun(db: Database.Database, run: WorkflowRun): void {
  db.prepare(`
    INSERT INTO workflow_runs (id, workflow_id, trigger_data, status, started_at, completed_at, error, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(run.id, run.workflow_id, run.trigger_data, run.status, run.started_at, run.completed_at ?? null, run.error ?? null, run.duration_ms ?? null)
}

export function getWorkflowRun(db: Database.Database, id: string): WorkflowRun | undefined {
  return db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as WorkflowRun | undefined
}

export function updateWorkflowRunStatus(db: Database.Database, id: string, status: WorkflowRun['status'], error?: string): void {
  const now = new Date()
  const completedAt = status !== 'running' ? now.toISOString() : null
  let durationMs: number | null = null
  if (completedAt) {
    const row = db.prepare('SELECT started_at FROM workflow_runs WHERE id = ?').get(id) as { started_at: string } | undefined
    if (row?.started_at) {
      durationMs = now.getTime() - new Date(row.started_at).getTime()
    }
  }
  db.prepare('UPDATE workflow_runs SET status = ?, completed_at = ?, error = ?, duration_ms = ? WHERE id = ?')
    .run(status, completedAt, error ?? null, durationMs, id)
}

// ─── CRUD: Step Runs ───

export function insertStepRun(db: Database.Database, stepRun: StepRun): void {
  db.prepare(`
    INSERT INTO step_runs (id, run_id, step_id, status, output_json, error, started_at, completed_at, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(stepRun.id, stepRun.run_id, stepRun.step_id, stepRun.status, stepRun.output_json ?? null, stepRun.error ?? null, stepRun.started_at ?? null, stepRun.completed_at ?? null, stepRun.duration_ms ?? null)
}

export function getStepRun(db: Database.Database, id: string): StepRun | undefined {
  return db.prepare('SELECT * FROM step_runs WHERE id = ?').get(id) as StepRun | undefined
}

export function updateStepRunStatus(db: Database.Database, id: string, status: StepRun['status'], output?: string, error?: string): void {
  const now = new Date()
  const completedAt = status === 'succeeded' || status === 'failed' || status === 'skipped' ? now.toISOString() : null
  let durationMs: number | null = null
  if (completedAt) {
    const row = db.prepare('SELECT started_at FROM step_runs WHERE id = ?').get(id) as { started_at: string } | undefined
    if (row?.started_at) {
      durationMs = now.getTime() - new Date(row.started_at).getTime()
    }
  }
  db.prepare('UPDATE step_runs SET status = ?, output_json = ?, error = ?, completed_at = ?, duration_ms = ? WHERE id = ?')
    .run(status, output ?? null, error ?? null, completedAt, durationMs, id)
}

export function getStepRunsByRunId(db: Database.Database, runId: string): StepRun[] {
  return db.prepare('SELECT * FROM step_runs WHERE run_id = ?').all(runId) as StepRun[]
}

export function getWorkflowRunsByWorkflowId(db: Database.Database, workflowId: string): WorkflowRun[] {
  return db.prepare('SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC').all(workflowId) as WorkflowRun[]
}
