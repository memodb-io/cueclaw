import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from 'ink-testing-library'
import { Text } from 'ink'
import { KeypressProvider, useKeypress, KeyPriority, type KeyPriorityLevel, type KeypressHandler } from './use-keypress.js'

afterEach(cleanup)

// Each handler gets its own component to respect rules of hooks
function Handler({ id, priority, handler, isActive = true }: {
  id: string
  priority: KeyPriorityLevel
  handler: KeypressHandler
  isActive?: boolean
}) {
  useKeypress(id, priority, handler, isActive)
  return null
}

describe('KeypressProvider + useKeypress', () => {
  it('dispatches keypress to registered handler', async () => {
    const handler = vi.fn()
    const { stdin } = render(
      <KeypressProvider>
        <Handler id="test" priority={KeyPriority.Normal} handler={handler} />
        <Text>test</Text>
      </KeypressProvider>
    )

    // Allow useEffect to fire
    await new Promise(r => setTimeout(r, 50))
    stdin.write('a')
    expect(handler).toHaveBeenCalled()
    expect(handler.mock.calls[0]![0]).toBe('a')
  })

  it('higher priority handler receives keypress first', async () => {
    const order: string[] = []
    const lowHandler = vi.fn(() => { order.push('low') })
    const highHandler = vi.fn(() => { order.push('high') })

    const { stdin } = render(
      <KeypressProvider>
        <Handler id="low" priority={KeyPriority.Low} handler={lowHandler} />
        <Handler id="high" priority={KeyPriority.High} handler={highHandler} />
        <Text>test</Text>
      </KeypressProvider>
    )

    await new Promise(r => setTimeout(r, 50))
    stdin.write('x')
    expect(order[0]).toBe('high')
    expect(order[1]).toBe('low')
  })

  it('consuming handler prevents lower-priority handlers from receiving keypress', async () => {
    const lowHandler = vi.fn()
    const highHandler = vi.fn(() => true) // consume

    const { stdin } = render(
      <KeypressProvider>
        <Handler id="low" priority={KeyPriority.Low} handler={lowHandler} />
        <Handler id="high" priority={KeyPriority.High} handler={highHandler} />
        <Text>test</Text>
      </KeypressProvider>
    )

    await new Promise(r => setTimeout(r, 50))
    stdin.write('x')
    expect(highHandler).toHaveBeenCalled()
    expect(lowHandler).not.toHaveBeenCalled()
  })

  it('inactive handler does not receive keypresses', async () => {
    const handler = vi.fn()
    const { stdin } = render(
      <KeypressProvider>
        <Handler id="test" priority={KeyPriority.Normal} handler={handler} isActive={false} />
        <Text>test</Text>
      </KeypressProvider>
    )

    await new Promise(r => setTimeout(r, 50))
    stdin.write('a')
    expect(handler).not.toHaveBeenCalled()
  })

  it('same-priority handlers both receive the keypress when not consumed', async () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    const { stdin } = render(
      <KeypressProvider>
        <Handler id="one" priority={KeyPriority.Normal} handler={handler1} />
        <Handler id="two" priority={KeyPriority.Normal} handler={handler2} />
        <Text>test</Text>
      </KeypressProvider>
    )

    await new Promise(r => setTimeout(r, 50))
    stdin.write('z')
    expect(handler1).toHaveBeenCalled()
    expect(handler2).toHaveBeenCalled()
  })
})
