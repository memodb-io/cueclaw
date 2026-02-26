# cueclaw

## 0.1.0

### Minor Changes

- Add chat intent classification and Telegram callback button support. Non-command messages are now classified via LLM to distinguish casual chat from workflow requests, and Telegram inline keyboard buttons (Confirm/Modify/Cancel) are properly wired.

## 0.0.4

### Patch Changes

- bc06eca: CI: release workflow now triggers only after CI passes via workflow_run

## 0.0.3

### Patch Changes

- 46110e3: Fix CI release pipeline: remove redundant GitHub Release step that conflicted with changesets built-in release creation

## 0.0.2

### Patch Changes

- 7052ebd: Add CI pipeline, changesets, commitlint, dependabot, and GitHub templates
