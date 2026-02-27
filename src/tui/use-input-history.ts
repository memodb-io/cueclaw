import { useRef, useCallback } from 'react'

interface InputHistory {
  /** Navigate up (older). Returns the history entry or undefined if at the end. */
  up: (currentValue: string) => string | undefined
  /** Navigate down (newer). Returns the entry, draft, or undefined if already at bottom. */
  down: () => string | undefined
  /** Push a submitted value into history. Skips duplicates of the most recent entry. */
  push: (value: string) => void
  /** Reset browsing state. Call when the user types a character. */
  resetBrowsing: () => void
}

/**
 * Hook that provides input history navigation (up/down arrow through previous inputs).
 *
 * History is stored newest-first. `historyIndex` of -1 means "editing new input",
 * 0 means the most recent entry, etc.
 */
export function useInputHistory(): InputHistory {
  const historyRef = useRef<string[]>([])
  const indexRef = useRef(-1)
  const draftRef = useRef('')

  const up = useCallback((currentValue: string): string | undefined => {
    const history = historyRef.current
    if (history.length === 0) return undefined

    const nextIndex = indexRef.current + 1
    if (nextIndex >= history.length) return undefined

    // Save draft on first up press
    if (indexRef.current === -1) {
      draftRef.current = currentValue
    }

    indexRef.current = nextIndex
    return history[nextIndex]
  }, [])

  const down = useCallback((): string | undefined => {
    if (indexRef.current === -1) return undefined

    const nextIndex = indexRef.current - 1
    indexRef.current = nextIndex

    if (nextIndex === -1) {
      // Restore draft
      return draftRef.current
    }

    return historyRef.current[nextIndex]
  }, [])

  const push = useCallback((value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    // Skip duplicate of most recent entry
    if (historyRef.current[0] === trimmed) {
      indexRef.current = -1
      draftRef.current = ''
      return
    }
    historyRef.current.unshift(trimmed)
    indexRef.current = -1
    draftRef.current = ''
  }, [])

  const resetBrowsing = useCallback(() => {
    indexRef.current = -1
    draftRef.current = ''
  }, [])

  return { up, down, push, resetBrowsing }
}
