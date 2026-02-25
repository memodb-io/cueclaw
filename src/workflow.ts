import type { PlanStep } from './types.js'

/** Validate that steps form a valid DAG with correct references */
export function validateDAG(steps: PlanStep[]): string[] {
  const errors: string[] = []
  const stepIds = new Set(steps.map(s => s.id))

  // Check depends_on references exist
  for (const step of steps) {
    for (const dep of step.depends_on) {
      if (!stepIds.has(dep)) {
        errors.push(`Step "${step.id}" depends on unknown step "${dep}"`)
      }
    }
  }

  // Check $steps.{id}.output references in inputs
  for (const step of steps) {
    const refs = extractStepRefs(step.inputs)
    for (const ref of refs) {
      if (!stepIds.has(ref)) {
        errors.push(`Step "${step.id}" references unknown step "${ref}" in inputs`)
      }
      if (stepIds.has(ref) && !step.depends_on.includes(ref)) {
        errors.push(`Step "${step.id}" references "$steps.${ref}.output" but does not list "${ref}" in depends_on`)
      }
    }
  }

  // Cycle detection via topological sort
  if (hasCycle(steps)) {
    errors.push('DAG contains a cycle')
  }

  return errors
}

/** Extract all $steps.{id}.output references from an inputs object */
function extractStepRefs(obj: unknown): string[] {
  const refs: string[] = []
  const pattern = /\$steps\.([a-z0-9-]+)\.output/g

  function walk(value: unknown): void {
    if (typeof value === 'string') {
      let match
      while ((match = pattern.exec(value)) !== null) {
        refs.push(match[1]!)
      }
      pattern.lastIndex = 0
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item)
    } else if (value !== null && typeof value === 'object') {
      for (const v of Object.values(value as Record<string, unknown>)) walk(v)
    }
  }

  walk(obj)
  return refs
}

/** Kahn's algorithm for cycle detection */
function hasCycle(steps: PlanStep[]): boolean {
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const step of steps) {
    inDegree.set(step.id, 0)
    adjacency.set(step.id, [])
  }

  for (const step of steps) {
    for (const dep of step.depends_on) {
      if (adjacency.has(dep)) {
        adjacency.get(dep)!.push(step.id)
        inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1)
      }
    }
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  let processed = 0
  while (queue.length > 0) {
    const current = queue.shift()!
    processed++
    for (const neighbor of adjacency.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1
      inDegree.set(neighbor, newDeg)
      if (newDeg === 0) queue.push(neighbor)
    }
  }

  return processed !== steps.length
}

/** Topological sort — returns ordered step IDs */
export function topologicalSort(steps: PlanStep[]): string[] {
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const step of steps) {
    inDegree.set(step.id, 0)
    adjacency.set(step.id, [])
  }

  for (const step of steps) {
    for (const dep of step.depends_on) {
      if (adjacency.has(dep)) {
        adjacency.get(dep)!.push(step.id)
        inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1)
      }
    }
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const order: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()!
    order.push(current)
    for (const neighbor of adjacency.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1
      inDegree.set(neighbor, newDeg)
      if (newDeg === 0) queue.push(neighbor)
    }
  }

  return order
}
