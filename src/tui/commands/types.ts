import type Database from 'better-sqlite3'
import type { CueclawConfig } from '../../config.js'
import type { DaemonBridge } from '../daemon-bridge.js'
import type { ChatMessage } from '../ui-state-context.js'

export interface CommandContext {
  db: Database.Database
  config: CueclawConfig | null
  cwd: string
  bridge: DaemonBridge | null
  addMessage: (msg: ChatMessage) => void
  clearMessages: () => void
  setConfig: (config: CueclawConfig) => void
  setThemeVersion: (fn: (v: number) => number) => void
}

export interface SlashCommand {
  name: string
  aliases: string[]
  description: string
  usage: string
  completion?: string[]
  execute: (args: string, ctx: CommandContext) => Promise<void> | void
}
