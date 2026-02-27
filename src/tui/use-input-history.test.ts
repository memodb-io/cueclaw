import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from 'ink-testing-library'
import { createElement, useRef } from 'react'
import { Text } from 'ink'
import { useInputHistory } from './use-input-history.js'

afterEach(cleanup)

// Render a component that exposes the hook's return value via a ref
function renderHistory() {
  const resultRef: { current: ReturnType<typeof useInputHistory> | null } = { current: null }

  function TestComp() {
    const history = useInputHistory()
    // Store in outer ref so test can access
    const ref = useRef(resultRef)
    ref.current.current = history
    return createElement(Text, null, 'test')
  }

  render(createElement(TestComp))
  return { get history() { return resultRef.current! } }
}

describe('useInputHistory', () => {
  it('returns undefined on up when history is empty', () => {
    const { history } = renderHistory()
    expect(history.up('')).toBeUndefined()
  })

  it('returns undefined on down when at bottom', () => {
    const { history } = renderHistory()
    expect(history.down()).toBeUndefined()
  })

  it('navigates up through history', () => {
    const { history } = renderHistory()
    history.push('first')
    history.push('second')

    expect(history.up('')).toBe('second')
    expect(history.up('')).toBe('first')
    expect(history.up('')).toBeUndefined()
  })

  it('navigates down through history back to draft', () => {
    const { history } = renderHistory()
    history.push('first')
    history.push('second')

    history.up('my draft')
    history.up('')

    expect(history.down()).toBe('second')
    expect(history.down()).toBe('my draft')
    expect(history.down()).toBeUndefined()
  })

  it('saves draft on first up press and restores it', () => {
    const { history } = renderHistory()
    history.push('old')

    expect(history.up('partial input')).toBe('old')
    expect(history.down()).toBe('partial input')
  })

  it('skips duplicate of most recent entry', () => {
    const { history } = renderHistory()
    history.push('same')
    history.push('same')

    expect(history.up('')).toBe('same')
    expect(history.up('')).toBeUndefined()
  })

  it('does not skip non-consecutive duplicates', () => {
    const { history } = renderHistory()
    history.push('a')
    history.push('b')
    history.push('a')

    expect(history.up('')).toBe('a')
    expect(history.up('')).toBe('b')
    expect(history.up('')).toBe('a')
  })

  it('skips empty/whitespace-only values', () => {
    const { history } = renderHistory()
    history.push('')
    history.push('   ')

    expect(history.up('')).toBeUndefined()
  })

  it('resetBrowsing returns to editing state', () => {
    const { history } = renderHistory()
    history.push('entry')

    history.up('')
    history.resetBrowsing()

    expect(history.down()).toBeUndefined()
    expect(history.up('')).toBe('entry')
  })

  it('push resets browsing state', () => {
    const { history } = renderHistory()
    history.push('first')

    history.up('')
    history.push('second')

    expect(history.up('')).toBe('second')
    expect(history.up('')).toBe('first')
  })
})
