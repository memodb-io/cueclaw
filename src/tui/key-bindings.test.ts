import { describe, it, expect } from 'vitest'
import { keyBindings } from './key-bindings.js'
import type { Key } from 'ink'

function makeKey(overrides: Partial<Key> = {}): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    ...overrides,
  }
}

describe('keyBindings', () => {
  it('ctrlC matches ctrl+c', () => {
    expect(keyBindings.ctrlC('c', makeKey({ ctrl: true }))).toBe(true)
    expect(keyBindings.ctrlC('c', makeKey())).toBe(false)
    expect(keyBindings.ctrlC('x', makeKey({ ctrl: true }))).toBe(false)
  })

  it('ctrlD matches ctrl+d', () => {
    expect(keyBindings.ctrlD('d', makeKey({ ctrl: true }))).toBe(true)
  })

  it('escape matches escape key', () => {
    expect(keyBindings.escape('', makeKey({ escape: true }))).toBe(true)
    expect(keyBindings.escape('', makeKey())).toBe(false)
  })

  it('submit matches return key', () => {
    expect(keyBindings.submit('', makeKey({ return: true }))).toBe(true)
  })

  it('scrollUp matches ctrl+p', () => {
    expect(keyBindings.scrollUp('p', makeKey({ ctrl: true }))).toBe(true)
    expect(keyBindings.scrollUp('n', makeKey({ ctrl: true }))).toBe(false)
  })

  it('scrollDown matches ctrl+n', () => {
    expect(keyBindings.scrollDown('n', makeKey({ ctrl: true }))).toBe(true)
  })

  it('confirmPlan matches y/Y', () => {
    expect(keyBindings.confirmPlan('y', makeKey())).toBe(true)
    expect(keyBindings.confirmPlan('Y', makeKey())).toBe(true)
    expect(keyBindings.confirmPlan('n', makeKey())).toBe(false)
  })

  it('modifyPlan matches m/M', () => {
    expect(keyBindings.modifyPlan('m', makeKey())).toBe(true)
    expect(keyBindings.modifyPlan('M', makeKey())).toBe(true)
  })

  it('cancelPlan matches n/N', () => {
    expect(keyBindings.cancelPlan('n', makeKey())).toBe(true)
    expect(keyBindings.cancelPlan('N', makeKey())).toBe(true)
  })

  it('abortExec matches x', () => {
    expect(keyBindings.abortExec('x', makeKey())).toBe(true)
    expect(keyBindings.abortExec('X', makeKey())).toBe(false)
  })

  it('quit matches q', () => {
    expect(keyBindings.quit('q', makeKey())).toBe(true)
  })

  it('confirmNo matches n or escape', () => {
    expect(keyBindings.confirmNo('n', makeKey())).toBe(true)
    expect(keyBindings.confirmNo('', makeKey({ escape: true }))).toBe(true)
  })
})
