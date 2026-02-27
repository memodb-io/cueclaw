import { useReducer, useEffect, useRef, useCallback } from 'react'
import { Text } from 'ink'
import { useKeypress, KeyPriority } from './use-keypress.js'

// ─── Resettable TextInput ───
// @inkjs/ui TextInput has no way to clear after submit. This is a minimal
// controlled version using ink's useInput that supports reset.

type InputAction =
  | { type: 'insert'; text: string }
  | { type: 'delete' }
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'reset' }
  | { type: 'set'; value: string; cursor: number }

interface InputState { value: string; prevValue: string; cursor: number }

export function inputReducer(state: InputState, action: InputAction): InputState {
  switch (action.type) {
    case 'insert': {
      const value = state.value.slice(0, state.cursor) + action.text + state.value.slice(state.cursor)
      return { value, prevValue: state.value, cursor: state.cursor + action.text.length }
    }
    case 'delete': {
      if (state.cursor === 0) return state
      const value = state.value.slice(0, state.cursor - 1) + state.value.slice(state.cursor)
      return { value, prevValue: state.value, cursor: state.cursor - 1 }
    }
    case 'left': return { ...state, cursor: Math.max(0, state.cursor - 1) }
    case 'right': return { ...state, cursor: Math.min(state.value.length, state.cursor + 1) }
    case 'reset': return { value: '', prevValue: state.value, cursor: 0 }
    case 'set': return { value: action.value, prevValue: state.value, cursor: action.cursor }
  }
}

export function ResettableInput({ placeholder, onSubmit, onChange, isDisabled, onUpArrow, onDownArrow }: {
  placeholder: string
  onSubmit: (value: string) => void
  onChange?: (value: string) => void
  isDisabled?: boolean
  onUpArrow?: (currentValue: string) => string | undefined
  onDownArrow?: () => string | undefined
}) {
  const [state, dispatch] = useReducer(inputReducer, { value: '', prevValue: '', cursor: 0 })
  const submitRef = useRef<string | null>(null)

  // Fire onChange via useEffect to avoid stale closure issues
  useEffect(() => {
    if (state.value !== state.prevValue) {
      onChange?.(state.value)
    }
  }, [state.value, state.prevValue, onChange])

  // Fire onSubmit after reset
  useEffect(() => {
    if (submitRef.current !== null) {
      const value = submitRef.current
      submitRef.current = null
      onSubmit(value)
    }
  })

  useKeypress('resettable-input', KeyPriority.Normal, useCallback((input, key) => {
    if ((key.ctrl && input === 'c') || key.tab || (key.shift && key.tab)) return false
    if (key.upArrow) {
      if (onUpArrow) {
        const entry = onUpArrow(state.value)
        if (entry !== undefined) dispatch({ type: 'set', value: entry, cursor: entry.length })
      }
      return true
    }
    if (key.downArrow) {
      if (onDownArrow) {
        const entry = onDownArrow()
        if (entry !== undefined) dispatch({ type: 'set', value: entry, cursor: entry.length })
      }
      return true
    }
    if (key.return) {
      submitRef.current = state.value
      dispatch({ type: 'reset' })
      return true
    }
    if (key.leftArrow) { dispatch({ type: 'left' }); return true }
    if (key.rightArrow) { dispatch({ type: 'right' }); return true }
    if (key.backspace || key.delete) { dispatch({ type: 'delete' }); return true }
    dispatch({ type: 'insert', text: input })
    return true
  }, [state.value, onUpArrow, onDownArrow]), !isDisabled)

  if (state.value.length === 0) {
    return (
      <Text>
        <Text inverse>{placeholder?.[0] ?? ' '}</Text>
        <Text dimColor>{placeholder?.slice(1) ?? ''}</Text>
      </Text>
    )
  }

  const before = state.value.slice(0, state.cursor)
  const cursorChar = state.value[state.cursor] ?? ' '
  const after = state.value.slice(state.cursor + 1)

  return (
    <Text>
      {before}
      <Text inverse>{cursorChar}</Text>
      {after}
    </Text>
  )
}
