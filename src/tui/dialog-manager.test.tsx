import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from 'ink-testing-library'
import { Text } from 'ink'
import { KeypressProvider } from './use-keypress.js'
import { DialogManager, useDialog, DialogPriority } from './dialog-manager.js'
import type { Dialog } from './dialog-manager.js'

afterEach(cleanup)

const delay = (ms = 50) => new Promise(r => setTimeout(r, ms))

function DialogTrigger({ dialog }: { dialog: Dialog }) {
  const { showDialog } = useDialog()
  React.useEffect(() => {
    showDialog(dialog)
  }, [])
  return <Text>content</Text>
}

function renderWithDialog(dialog: Dialog) {
  return render(
    <KeypressProvider>
      <DialogManager>
        <DialogTrigger dialog={dialog} />
      </DialogManager>
    </KeypressProvider>
  )
}

describe('DialogManager', () => {
  it('renders dialog overlay with title and message', async () => {
    const { lastFrame } = renderWithDialog({
      title: 'Confirm Exit',
      message: 'Are you sure?',
      actions: [{ key: 'y', label: 'Yes', handler: vi.fn() }],
    })
    await delay()
    const frame = lastFrame()!
    expect(frame).toContain('Confirm Exit')
    expect(frame).toContain('Are you sure?')
  })

  it('renders action keys', async () => {
    const { lastFrame } = renderWithDialog({
      title: 'Test',
      message: 'msg',
      actions: [
        { key: 'y', label: 'Yes', handler: vi.fn() },
        { key: 'n', label: 'No', handler: vi.fn() },
      ],
    })
    await delay()
    const frame = lastFrame()!
    expect(frame).toContain('[Y]')
    expect(frame).toContain('Yes')
    expect(frame).toContain('[N]')
    expect(frame).toContain('No')
    expect(frame).toContain('Esc')
  })

  it('calls action handler on key press', async () => {
    const handler = vi.fn()
    const { stdin } = renderWithDialog({
      title: 'Test',
      message: 'msg',
      actions: [{ key: 'y', label: 'Yes', handler }],
    })
    await delay()
    stdin.write('y')
    expect(handler).toHaveBeenCalledOnce()
  })

  it('dismisses on Esc', async () => {
    const { stdin, lastFrame } = renderWithDialog({
      title: 'Dismiss Test',
      message: 'will go away',
      actions: [{ key: 'y', label: 'Yes', handler: vi.fn() }],
    })
    await delay()
    expect(lastFrame()!).toContain('Dismiss Test')
    stdin.write('\x1B')
    await delay()
    expect(lastFrame()!).not.toContain('Dismiss Test')
  })

  it('renders children alongside dialog', async () => {
    const { lastFrame } = renderWithDialog({
      title: 'Dialog',
      message: 'msg',
      actions: [],
    })
    await delay()
    expect(lastFrame()!).toContain('content')
  })
})

describe('DialogManager priority queue', () => {
  it('shows highest priority dialog first', async () => {
    function MultiDialogTrigger() {
      const { showDialog } = useDialog()
      React.useEffect(() => {
        showDialog({
          title: 'Low Priority',
          message: 'low',
          actions: [{ key: 'y', label: 'Yes', handler: vi.fn() }],
          priority: DialogPriority.Normal,
        })
        showDialog({
          title: 'High Priority',
          message: 'high',
          actions: [{ key: 'y', label: 'Yes', handler: vi.fn() }],
          priority: DialogPriority.Critical,
        })
      }, [])
      return <Text>content</Text>
    }

    const { lastFrame } = render(
      <KeypressProvider>
        <DialogManager>
          <MultiDialogTrigger />
        </DialogManager>
      </KeypressProvider>
    )
    await delay()
    const frame = lastFrame()!
    expect(frame).toContain('High Priority')
  })

  it('shows next dialog after dismissing current', async () => {
    function MultiDialogTrigger() {
      const { showDialog } = useDialog()
      React.useEffect(() => {
        showDialog({
          title: 'First',
          message: 'first',
          actions: [{ key: 'y', label: 'Yes', handler: vi.fn() }],
          priority: DialogPriority.High,
        })
        showDialog({
          title: 'Second',
          message: 'second',
          actions: [{ key: 'y', label: 'Yes', handler: vi.fn() }],
          priority: DialogPriority.Normal,
        })
      }, [])
      return <Text>content</Text>
    }

    const { stdin, lastFrame } = render(
      <KeypressProvider>
        <DialogManager>
          <MultiDialogTrigger />
        </DialogManager>
      </KeypressProvider>
    )
    await delay()
    expect(lastFrame()!).toContain('First')
    stdin.write('\x1B') // Esc to dismiss
    await delay()
    expect(lastFrame()!).toContain('Second')
  })
})
