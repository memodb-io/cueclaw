import type { Key } from 'ink'

type KeyMatcher = (input: string, key: Key) => boolean

export const keyBindings = {
  ctrlC: ((input, key) => input === 'c' && key.ctrl) as KeyMatcher,
  ctrlD: ((input, key) => input === 'd' && key.ctrl) as KeyMatcher,
  escape: ((_input, key) => key.escape) as KeyMatcher,
  submit: ((_input, key) => key.return) as KeyMatcher,
  scrollUp: ((input, key) => key.ctrl && input === 'p') as KeyMatcher,
  scrollDown: ((input, key) => key.ctrl && input === 'n') as KeyMatcher,
  confirmPlan: ((input) => input.toLowerCase() === 'y') as KeyMatcher,
  modifyPlan: ((input) => input.toLowerCase() === 'm') as KeyMatcher,
  cancelPlan: ((input) => input.toLowerCase() === 'n') as KeyMatcher,
  abortExec: ((input) => input === 'x') as KeyMatcher,
  quit: ((input) => input === 'q') as KeyMatcher,
  upArrow: ((_input, key) => key.upArrow) as KeyMatcher,
  downArrow: ((_input, key) => key.downArrow) as KeyMatcher,
  stopWorkflow: ((input) => input === 's') as KeyMatcher,
  deleteWorkflow: ((input) => input === 'x') as KeyMatcher,
  confirmYes: ((input) => input.toLowerCase() === 'y') as KeyMatcher,
  confirmNo: ((input, key) => input.toLowerCase() === 'n' || key.escape) as KeyMatcher,
} as const
