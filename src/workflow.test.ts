import { describe, it, expect } from 'vitest'
import { validateDAG, topologicalSort } from './workflow.js'
import type { PlanStep } from './types.js'

function step(id: string, depends_on: string[] = [], inputs: Record<string, any> = {}): PlanStep {
  return { id, description: `Step ${id}`, agent: 'claude', inputs, depends_on }
}

describe('validateDAG', () => {
  it('accepts a valid linear DAG', () => {
    const steps = [
      step('a'),
      step('b', ['a']),
      step('c', ['b']),
    ]
    expect(validateDAG(steps)).toEqual([])
  })

  it('accepts a valid parallel DAG', () => {
    const steps = [
      step('a'),
      step('b'),
      step('c', ['a', 'b']),
    ]
    expect(validateDAG(steps)).toEqual([])
  })

  it('accepts a single step with no dependencies', () => {
    expect(validateDAG([step('only')])).toEqual([])
  })

  it('detects unknown dependency', () => {
    const steps = [step('a', ['nonexistent'])]
    const errors = validateDAG(steps)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('unknown step "nonexistent"')
  })

  it('detects cycle (A -> B -> A)', () => {
    const steps = [
      step('a', ['b']),
      step('b', ['a']),
    ]
    const errors = validateDAG(steps)
    expect(errors.some(e => e.includes('cycle'))).toBe(true)
  })

  it('detects cycle in longer chain (A -> B -> C -> A)', () => {
    const steps = [
      step('a', ['c']),
      step('b', ['a']),
      step('c', ['b']),
    ]
    const errors = validateDAG(steps)
    expect(errors.some(e => e.includes('cycle'))).toBe(true)
  })

  it('detects $steps reference to unknown step', () => {
    const steps = [
      step('a'),
      step('b', ['a'], { data: '$steps.unknown.output' }),
    ]
    const errors = validateDAG(steps)
    expect(errors.some(e => e.includes('unknown step "unknown"'))).toBe(true)
  })

  it('detects $steps reference not in depends_on', () => {
    const steps = [
      step('a'),
      step('b'),
      step('c', ['a'], { data: '$steps.b.output' }),
    ]
    const errors = validateDAG(steps)
    expect(errors.some(e => e.includes('does not list "b" in depends_on'))).toBe(true)
  })

  it('accepts valid $steps reference with depends_on', () => {
    const steps = [
      step('a'),
      step('b', ['a'], { context: '$steps.a.output' }),
    ]
    expect(validateDAG(steps)).toEqual([])
  })

  it('handles nested $steps references in inputs', () => {
    const steps = [
      step('a'),
      step('b', ['a'], { nested: { deep: '$steps.a.output' } }),
    ]
    expect(validateDAG(steps)).toEqual([])
  })
})

describe('topologicalSort', () => {
  it('sorts linear DAG', () => {
    const steps = [
      step('c', ['b']),
      step('a'),
      step('b', ['a']),
    ]
    const order = topologicalSort(steps)
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'))
  })

  it('sorts diamond DAG', () => {
    const steps = [
      step('a'),
      step('b', ['a']),
      step('c', ['a']),
      step('d', ['b', 'c']),
    ]
    const order = topologicalSort(steps)
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'))
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'))
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'))
  })

  it('handles independent steps', () => {
    const steps = [step('a'), step('b'), step('c')]
    const order = topologicalSort(steps)
    expect(order).toHaveLength(3)
    expect(new Set(order)).toEqual(new Set(['a', 'b', 'c']))
  })
})
