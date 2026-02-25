import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { prepareContainerOpts } from './container-runner.js'

describe('prepareContainerOpts', () => {
  it('creates work and ipc directories', () => {
    const result = prepareContainerOpts('wf1', 'step1', 'run1', 'test prompt', '/tmp/project')

    expect(result.workflowId).toBe('wf1')
    expect(result.stepId).toBe('step1')
    expect(result.runId).toBe('run1')
    expect(result.prompt).toBe('test prompt')
    expect(result.cwd).toBe('/tmp/project')
    expect(result.containerName).toMatch(/^cueclaw-wf1-step1-\d+$/)
    expect(existsSync(result.workDir)).toBe(true)
    expect(existsSync(join(result.ipcDir, 'input'))).toBe(true)
    expect(existsSync(join(result.ipcDir, 'output'))).toBe(true)
  })

  it('passes through allowedTools', () => {
    const result = prepareContainerOpts('wf1', 'step1', 'run1', 'test', '/tmp', ['Bash', 'Read'])
    expect(result.allowedTools).toEqual(['Bash', 'Read'])
  })
})
