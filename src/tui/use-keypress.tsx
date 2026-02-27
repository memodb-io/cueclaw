import React, { createContext, useContext, useRef, useCallback, useEffect } from 'react'
import { useInput } from 'ink'
import type { Key } from 'ink'

// ─── Priority Levels ───

export const KeyPriority = {
  Low: 0,
  Normal: 100,
  High: 200,
  Critical: 300,
} as const

export type KeyPriorityLevel = (typeof KeyPriority)[keyof typeof KeyPriority]

// ─── Types ───

/** Return true to consume the keypress and prevent lower-priority handlers from receiving it. */
export type KeypressHandler = (input: string, key: Key) => boolean | void

interface HandlerEntry {
  id: string
  priority: KeyPriorityLevel
  handler: KeypressHandler
  isActive: boolean
}

interface KeypressContextValue {
  register: (entry: HandlerEntry) => void
  unregister: (id: string) => void
  update: (id: string, patch: Partial<Pick<HandlerEntry, 'handler' | 'isActive'>>) => void
}

const KeypressContext = createContext<KeypressContextValue | null>(null)

// ─── Provider ───

export function KeypressProvider({ children }: { children: React.ReactNode }) {
  const handlersRef = useRef<HandlerEntry[]>([])

  const register = useCallback((entry: HandlerEntry) => {
    handlersRef.current = [...handlersRef.current.filter(h => h.id !== entry.id), entry]
  }, [])

  const unregister = useCallback((id: string) => {
    handlersRef.current = handlersRef.current.filter(h => h.id !== id)
  }, [])

  const update = useCallback((id: string, patch: Partial<Pick<HandlerEntry, 'handler' | 'isActive'>>) => {
    handlersRef.current = handlersRef.current.map(h =>
      h.id === id ? { ...h, ...patch } : h
    )
  }, [])

  // Single top-level useInput that dispatches to registered handlers
  useInput((input, key) => {
    // Sort by priority descending
    const sorted = [...handlersRef.current]
      .filter(h => h.isActive)
      .sort((a, b) => b.priority - a.priority)

    for (const entry of sorted) {
      const consumed = entry.handler(input, key)
      if (consumed === true) break
    }
  })

  return (
    <KeypressContext.Provider value={{ register, unregister, update }}>
      {children}
    </KeypressContext.Provider>
  )
}

// ─── Hook ───

let nextId = 0

/**
 * Register a keypress handler with priority-based dispatch.
 *
 * @param id - Unique identifier for this handler
 * @param priority - Higher priority handlers receive keypresses first
 * @param handler - Return `true` to consume the keypress
 * @param isActive - Whether this handler is currently active
 */
export function useKeypress(
  id: string,
  priority: KeyPriorityLevel,
  handler: KeypressHandler,
  isActive = true,
) {
  const ctx = useContext(KeypressContext)
  const stableId = useRef(id || `keypress-${nextId++}`).current

  // Register on mount
  useEffect(() => {
    if (!ctx) return
    ctx.register({ id: stableId, priority, handler, isActive })
    return () => ctx.unregister(stableId)
  }, [ctx, stableId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update handler and isActive on changes
  useEffect(() => {
    if (!ctx) return
    ctx.update(stableId, { handler, isActive })
  }, [ctx, stableId, handler, isActive])
}
