import type { Channel, Workflow } from '../types.js'

/**
 * TUI Channel implementation.
 * In the TUI, messages are routed directly through the Ink component tree,
 * so this channel implementation is minimal — mainly for interface compliance.
 */
export class TuiChannel implements Channel {
  readonly name = 'tui' as const
  private sendFn: ((text: string) => void) | null = null

  constructor(sendFn?: (text: string) => void) {
    this.sendFn = sendFn ?? null
  }

  async connect(): Promise<void> {
    // No-op — TUI is always connected
  }

  async disconnect(): Promise<void> {
    this.sendFn = null
  }

  async sendMessage(_jid: string, text: string): Promise<void> {
    this.sendFn?.(text)
  }

  async sendConfirmation(_jid: string, workflow: Workflow): Promise<void> {
    this.sendFn?.(`Plan ready: "${workflow.name}". Confirm in TUI.`)
  }

  isConnected(): boolean {
    return true
  }

  ownsJid(_jid: string): boolean {
    return _jid === 'local'
  }
}
