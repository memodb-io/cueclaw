import {
  existsSync, readdirSync, readFileSync, writeFileSync,
  unlinkSync, renameSync, mkdirSync,
} from 'node:fs'
import { join } from 'node:path'
import { nanoid } from 'nanoid'
import { logger } from './logger.js'

export interface IpcMessage {
  workflowId: string
  stepId: string
  type: 'progress' | 'notification' | 'context_request' | 'user_message'
  correlationId?: string
  data: any
  timestamp: string
}

export class IpcWatcher {
  private timeout: NodeJS.Timeout | null = null

  constructor(
    private workflowId: string,
    _stepId: string,
    private ipcDir: string,
    private onMessage: (msg: IpcMessage) => void,
    private pollInterval = 500,
  ) {}

  start(): void {
    this.scheduleNext()
  }

  private scheduleNext(): void {
    this.timeout = setTimeout(async () => {
      await this.poll()
      if (this.timeout !== null) this.scheduleNext()
    }, this.pollInterval)
  }

  stop(): void {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }
  }

  private async poll(): Promise<void> {
    const outputDir = join(this.ipcDir, 'output')
    if (!existsSync(outputDir)) return

    const files = readdirSync(outputDir)
      .filter(f => f.endsWith('.json'))
      .sort()

    for (const file of files) {
      const filePath = join(outputDir, file)
      try {
        const content = readFileSync(filePath, 'utf-8')
        const msg = JSON.parse(content) as IpcMessage
        if (msg.workflowId !== this.workflowId) {
          logger.warn({ file, expected: this.workflowId, got: msg.workflowId }, 'IPC message workflow mismatch')
          this.moveToErrors(filePath, outputDir)
          continue
        }
        this.onMessage(msg)
        unlinkSync(filePath)
      } catch (err) {
        logger.error({ file, err }, 'Failed to process IPC message')
        this.moveToErrors(filePath, outputDir)
      }
    }
  }

  sendToContainer(msg: IpcMessage): void {
    const inputDir = join(this.ipcDir, 'input')
    mkdirSync(inputDir, { recursive: true })
    const filename = `${Date.now()}-${nanoid(6)}.json`
    const tempPath = join(inputDir, `.${filename}.tmp`)
    const finalPath = join(inputDir, filename)
    writeFileSync(tempPath, JSON.stringify(msg))
    renameSync(tempPath, finalPath)
  }

  signalClose(): void {
    writeFileSync(join(this.ipcDir, '_close'), '')
  }

  private moveToErrors(filePath: string, outputDir: string): void {
    const errorsDir = join(outputDir, '..', 'errors')
    mkdirSync(errorsDir, { recursive: true })
    const filename = filePath.split('/').pop()!
    try {
      renameSync(filePath, join(errorsDir, filename))
    } catch {
      // If rename fails, just delete the malformed file
      try { unlinkSync(filePath) } catch { /* ignore */ }
    }
  }
}
