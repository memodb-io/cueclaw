import type Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import type { Session } from './types.js'
import { logger } from './logger.js'

export function createSession(db: Database.Database, stepRunId: string, sdkSessionId?: string): Session {
  const now = new Date().toISOString()
  const session: Session = {
    id: `sess_${nanoid()}`,
    step_run_id: stepRunId,
    sdk_session_id: sdkSessionId,
    created_at: now,
    last_used_at: now,
    is_active: true,
  }

  db.prepare(`
    INSERT INTO sessions (id, step_run_id, sdk_session_id, created_at, last_used_at, is_active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(session.id, session.step_run_id, session.sdk_session_id ?? null, session.created_at, session.last_used_at, 1)

  logger.debug({ sessionId: session.id, stepRunId }, 'Session created')
  return session
}

interface SessionRow {
  id: string
  step_run_id: string
  sdk_session_id: string | null
  created_at: string
  last_used_at: string
  is_active: number
}

export function getActiveSession(db: Database.Database, stepRunId: string): Session | undefined {
  const row = db.prepare(
    'SELECT * FROM sessions WHERE step_run_id = ? AND is_active = 1 ORDER BY last_used_at DESC LIMIT 1'
  ).get(stepRunId) as SessionRow | undefined

  if (!row) return undefined
  return {
    id: row.id,
    step_run_id: row.step_run_id,
    sdk_session_id: row.sdk_session_id ?? undefined,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    is_active: row.is_active === 1,
  }
}

export function deactivateSession(db: Database.Database, sessionId: string): void {
  db.prepare('UPDATE sessions SET is_active = 0, last_used_at = ? WHERE id = ?')
    .run(new Date().toISOString(), sessionId)
  logger.debug({ sessionId }, 'Session deactivated')
}

export function updateSessionSdkId(db: Database.Database, sessionId: string, sdkSessionId: string): void {
  db.prepare('UPDATE sessions SET sdk_session_id = ?, last_used_at = ? WHERE id = ?')
    .run(sdkSessionId, new Date().toISOString(), sessionId)
  logger.debug({ sessionId, sdkSessionId }, 'Session SDK ID updated')
}

export function cleanupStaleSessions(db: Database.Database, maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): number {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString()
  const result = db.prepare('DELETE FROM sessions WHERE is_active = 0 AND last_used_at < ?').run(cutoff)
  logger.info({ deletedCount: result.changes, cutoff }, 'Stale sessions cleaned up')
  return result.changes
}
