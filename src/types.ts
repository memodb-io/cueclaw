// ─── Workflow Protocol v1 ───

/** LLM-generated portion — used as tool_use input_schema */
export interface PlannerOutput {
  name: string
  description: string
  trigger: TriggerConfig
  steps: PlanStep[]
  failure_policy: FailurePolicy
}

/** Complete type after framework fills remaining fields */
export interface Workflow extends PlannerOutput {
  schema_version: '1.0'
  id: string
  phase: WorkflowPhase
  created_at: string
  updated_at: string
  metadata?: Record<string, any>
}

export type WorkflowPhase =
  | 'planning'
  | 'awaiting_confirmation'
  | 'active'
  | 'executing'
  | 'paused'
  | 'completed'
  | 'failed'

// ─── Execution Records ───

export interface WorkflowRun {
  id: string
  workflow_id: string
  trigger_data: string | null
  status: 'running' | 'completed' | 'failed'
  started_at: string
  completed_at?: string
  error?: string
  duration_ms?: number
}

export interface StepRun {
  id: string
  run_id: string
  step_id: string
  status: StepStatus
  output_json?: string
  error?: string
  started_at?: string
  completed_at?: string
  duration_ms?: number
}

// ─── Plan Step ───

export interface PlanStep {
  id: string
  description: string
  expected_output?: string
  agent: 'claude'
  inputs: Record<string, any>
  depends_on: string[]
  position?: { x: number; y: number }
}

export type StepStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'

// ─── Failure Policy ───

export interface FailurePolicy {
  on_step_failure: 'stop' | 'skip_dependents' | 'ask_user'
  max_retries: number
  retry_delay_ms: number
}

// ─── Trigger Config ───

export type TriggerConfig =
  | { type: 'poll'; interval_seconds: number; check_script: string; diff_mode: 'new_items' | 'any_change' }
  | { type: 'cron'; expression: string; timezone?: string }
  | { type: 'manual' }

// ─── Channel Context ───

export interface ChannelContext {
  channel: 'tui' | 'telegram' | 'whatsapp'
  chatJid?: string   // bot channels only
  sender?: string    // bot channels only
}

// ─── Channel Interface ───

export interface Channel {
  name: string
  connect(): Promise<void>
  sendMessage(jid: string, text: string): Promise<string>
  editMessage?(jid: string, messageId: string, text: string): Promise<void>
  sendConfirmation(jid: string, workflow: Workflow): Promise<void>
  isConnected(): boolean
  ownsJid(jid: string): boolean
  disconnect(): Promise<void>
  setTyping?(jid: string, isTyping: boolean): Promise<void>
}

export interface NewMessage {
  text: string
  sender: string
  timestamp?: string
  replyTo?: string
  metadata?: Record<string, any>
}

export type OnInboundMessage = (chatJid: string, message: NewMessage) => void

// ─── Session ───

export interface Session {
  id: string
  step_run_id: string
  sdk_session_id?: string
  created_at: string
  last_used_at: string
  is_active: boolean
}

// ─── Container & Mount Types ───

export interface AdditionalMount {
  hostPath: string
  containerPath?: string
  readonly?: boolean
}

export interface MountAllowlist {
  allowedRoots: AllowedRoot[]
  blockedPatterns: string[]
  nonMainReadOnly: boolean
}

export interface AllowedRoot {
  path: string
  allowReadWrite: boolean
  description?: string
}

export interface ContainerConfig {
  additionalMounts?: AdditionalMount[]
  timeout?: number
}

// ─── Error Hierarchy ───

export class CueclawError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message)
    this.name = 'CueclawError'
  }
}

export class PlannerError extends CueclawError {
  constructor(message: string) { super(message, 'PLANNER_ERROR') }
}

export class ExecutorError extends CueclawError {
  constructor(message: string) { super(message, 'EXECUTOR_ERROR') }
}

export class TriggerError extends CueclawError {
  constructor(message: string) { super(message, 'TRIGGER_ERROR') }
}

export class ConfigError extends CueclawError {
  constructor(message: string) { super(message, 'CONFIG_ERROR') }
}
