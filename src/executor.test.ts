import { describe, it, expect, beforeEach } from 'vitest'
import { resolveValue, resolveInputs } from './executor.js'
import type { StepRunResult } from './agent-runner.js'

describe('resolveValue', () => {
  const completed = new Map<string, StepRunResult>()

  beforeEach(() => {
    completed.clear()
    completed.set('step-a', { status: 'succeeded', output: 'result-a' })
    completed.set('step-b', { status: 'succeeded', output: '{"key": "value"}' })
    completed.set('step-failed', { status: 'failed', error: 'something went wrong' })
    completed.set('step-skipped', { status: 'skipped' })
  })

  it('resolves $steps.{id}.output', () => {
    const result = resolveValue('Got: $steps.step-a.output', completed, null)
    expect(result).toBe('Got: result-a')
  })

  it('resolves $trigger_data', () => {
    const result = resolveValue('Data: $trigger_data', completed, '{"issue": 42}')
    expect(result).toBe('Data: {"issue": 42}')
  })

  it('resolves $trigger_data to null when no trigger data', () => {
    const result = resolveValue('Data: $trigger_data', completed, null)
    expect(result).toBe('Data: null')
  })

  it('resolves multiple references in one string', () => {
    const result = resolveValue('A=$steps.step-a.output B=$steps.step-b.output', completed, null)
    expect(result).toBe('A=result-a B={"key": "value"}')
  })

  it('returns null for unknown step reference', () => {
    const result = resolveValue('$steps.unknown.output', completed, null)
    expect(result).toBe('null')
  })

  it('returns __skip marker for failed step reference', () => {
    const result = resolveValue('$steps.step-failed.output', completed, null)
    expect(result).toEqual({ __skip: true })
  })

  it('returns __skip marker for skipped step reference', () => {
    const result = resolveValue('$steps.step-skipped.output', completed, null)
    expect(result).toEqual({ __skip: true })
  })

  it('truncates large outputs at 10KB', () => {
    const largeOutput = 'x'.repeat(20000)
    completed.set('step-large', { status: 'succeeded', output: largeOutput })
    const result = resolveValue('$steps.step-large.output', completed, null) as string
    expect(result.length).toBeLessThan(20000)
    expect(result).toContain('[truncated]')
  })

  it('handles non-string values', () => {
    expect(resolveValue(42, completed, null)).toBe(42)
    expect(resolveValue(true, completed, null)).toBe(true)
    expect(resolveValue(null, completed, null)).toBe(null)
  })

  it('handles arrays', () => {
    const result = resolveValue(['$steps.step-a.output', 'plain'], completed, null)
    expect(result).toEqual(['result-a', 'plain'])
  })

  it('handles nested objects', () => {
    const result = resolveValue({ nested: { ref: '$steps.step-a.output' } }, completed, null)
    expect(result).toEqual({ nested: { ref: 'result-a' } })
  })
})

describe('resolveInputs', () => {
  it('resolves all input values', () => {
    const completed = new Map<string, StepRunResult>()
    completed.set('fetch', { status: 'succeeded', output: 'issue #42' })

    const inputs = {
      issue: '$steps.fetch.output',
      trigger: '$trigger_data',
      static: 'hello',
    }

    const result = resolveInputs(inputs, completed, 'trigger-payload')
    expect(result).toEqual({
      issue: 'issue #42',
      trigger: 'trigger-payload',
      static: 'hello',
    })
  })
})
