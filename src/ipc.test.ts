import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { IpcWatcher, type IpcMessage } from './ipc.js'

describe('IpcWatcher', () => {
  let ipcDir: string

  beforeEach(() => {
    ipcDir = join(tmpdir(), `cueclaw-ipc-test-${Date.now()}`)
    mkdirSync(join(ipcDir, 'input'), { recursive: true })
    mkdirSync(join(ipcDir, 'output'), { recursive: true })
  })

  afterEach(() => {
    rmSync(ipcDir, { recursive: true, force: true })
  })

  it('polls and processes messages from output directory', async () => {
    const received: IpcMessage[] = []
    const watcher = new IpcWatcher('wf1', 'step1', ipcDir, (msg) => {
      received.push(msg)
    }, 50)

    const msg: IpcMessage = {
      workflowId: 'wf1',
      stepId: 'step1',
      type: 'progress',
      data: { status: 'running' },
      timestamp: new Date().toISOString(),
    }
    writeFileSync(join(ipcDir, 'output', '001.json'), JSON.stringify(msg))

    watcher.start()
    await new Promise(r => setTimeout(r, 200))
    watcher.stop()

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('progress')
    // File should be consumed
    expect(readdirSync(join(ipcDir, 'output')).filter(f => f.endsWith('.json'))).toHaveLength(0)
  })

  it('moves mismatched workflow messages to errors', async () => {
    const received: IpcMessage[] = []
    const watcher = new IpcWatcher('wf1', 'step1', ipcDir, (msg) => {
      received.push(msg)
    }, 50)

    const msg: IpcMessage = {
      workflowId: 'wrong-wf',
      stepId: 'step1',
      type: 'progress',
      data: {},
      timestamp: new Date().toISOString(),
    }
    writeFileSync(join(ipcDir, 'output', '001.json'), JSON.stringify(msg))

    watcher.start()
    await new Promise(r => setTimeout(r, 200))
    watcher.stop()

    expect(received).toHaveLength(0)
    expect(existsSync(join(ipcDir, 'errors'))).toBe(true)
  })

  it('sends messages to container via input directory', () => {
    const watcher = new IpcWatcher('wf1', 'step1', ipcDir, () => {}, 50)

    const msg: IpcMessage = {
      workflowId: 'wf1',
      stepId: 'step1',
      type: 'user_message',
      data: { context: 'test' },
      timestamp: new Date().toISOString(),
    }
    watcher.sendToContainer(msg)

    const files = readdirSync(join(ipcDir, 'input')).filter(f => f.endsWith('.json'))
    expect(files).toHaveLength(1)

    const content = JSON.parse(readFileSync(join(ipcDir, 'input', files[0]), 'utf-8'))
    expect(content.type).toBe('user_message')
  })

  it('signalClose writes _close sentinel', () => {
    const watcher = new IpcWatcher('wf1', 'step1', ipcDir, () => {}, 50)
    watcher.signalClose()
    expect(existsSync(join(ipcDir, '_close'))).toBe(true)
  })

  it('handles malformed JSON gracefully', async () => {
    const received: IpcMessage[] = []
    const watcher = new IpcWatcher('wf1', 'step1', ipcDir, (msg) => {
      received.push(msg)
    }, 50)

    writeFileSync(join(ipcDir, 'output', '001.json'), 'not valid json{{{')

    watcher.start()
    await new Promise(r => setTimeout(r, 200))
    watcher.stop()

    expect(received).toHaveLength(0)
    expect(existsSync(join(ipcDir, 'errors'))).toBe(true)
  })
})
