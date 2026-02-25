import { describe, it, expect } from 'vitest'
import {
  CueclawError,
  PlannerError,
  ExecutorError,
  TriggerError,
  ConfigError,
} from './types.js'

describe('Error Hierarchy', () => {
  it('CueclawError has code property', () => {
    const err = new CueclawError('test', 'TEST_CODE')
    expect(err.message).toBe('test')
    expect(err.code).toBe('TEST_CODE')
    expect(err.name).toBe('CueclawError')
    expect(err).toBeInstanceOf(Error)
  })

  it('PlannerError extends CueclawError', () => {
    const err = new PlannerError('bad plan')
    expect(err.code).toBe('PLANNER_ERROR')
    expect(err).toBeInstanceOf(CueclawError)
    expect(err).toBeInstanceOf(Error)
  })

  it('ExecutorError extends CueclawError', () => {
    const err = new ExecutorError('exec failed')
    expect(err.code).toBe('EXECUTOR_ERROR')
    expect(err).toBeInstanceOf(CueclawError)
  })

  it('TriggerError extends CueclawError', () => {
    const err = new TriggerError('trigger failed')
    expect(err.code).toBe('TRIGGER_ERROR')
    expect(err).toBeInstanceOf(CueclawError)
  })

  it('ConfigError extends CueclawError', () => {
    const err = new ConfigError('bad config')
    expect(err.code).toBe('CONFIG_ERROR')
    expect(err).toBeInstanceOf(CueclawError)
  })
})
