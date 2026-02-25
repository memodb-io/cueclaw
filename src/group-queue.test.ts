import { describe, it, expect } from 'vitest'
import { GroupQueue } from './group-queue.js'

describe('GroupQueue', () => {
  it('runs tasks up to max concurrency', async () => {
    const queue = new GroupQueue(2)
    const order: number[] = []

    const task = (id: number, delay: number) => async () => {
      order.push(id)
      await new Promise(r => setTimeout(r, delay))
    }

    await Promise.all([
      queue.enqueue('wf1', task(1, 50)),
      queue.enqueue('wf2', task(2, 50)),
      queue.enqueue('wf3', task(3, 10)),
    ])

    expect(order).toContain(1)
    expect(order).toContain(2)
    expect(order).toContain(3)
  })

  it('serializes tasks from the same workflow', async () => {
    const queue = new GroupQueue(5)
    const order: number[] = []

    const task = (id: number) => async () => {
      order.push(id)
      await new Promise(r => setTimeout(r, 20))
    }

    await Promise.all([
      queue.enqueue('wf1', task(1)),
      queue.enqueue('wf1', task(2)),
    ])

    // Both should complete, task 1 before task 2
    expect(order).toEqual([1, 2])
  })

  it('tracks active and pending counts', async () => {
    const queue = new GroupQueue(1)
    expect(queue.activeCount).toBe(0)
    expect(queue.pendingCount).toBe(0)

    let resolve1: () => void
    const p1 = new Promise<void>(r => { resolve1 = r })

    const promise = queue.enqueue('wf1', () => p1)

    // Small delay for the task to start
    await new Promise(r => setTimeout(r, 10))
    expect(queue.activeCount).toBe(1)

    resolve1!()
    await promise
    expect(queue.activeCount).toBe(0)
  })
})
