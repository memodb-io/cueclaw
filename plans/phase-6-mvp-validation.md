# Phase 6: MVP Validation

> **Goal:** Validate the entire system end-to-end by creating two real-world GitHub workflows using only natural language — no new code, just using the framework's own capabilities.
>
> **Prerequisites:** Phase 0–5 all complete. Daemon running in background. `gh` CLI and `git` installed and authenticated locally.

---

## What Gets Validated

Phase 6 is **not** about writing new code. The framework is complete after Phase 5. Phase 6 proves the system works by creating and running real workflows through the same interfaces a user would use.

Two validation workflows exercise the full stack:
1. **Issue → Branch → Plan → PR** (poll trigger + multi-step DAG + notifications)
2. **PR Review Loop** (poll trigger + conditional branching + interactive commands)

---

## Prerequisites Checklist

- [ ] `cueclaw daemon status` shows "running"
- [ ] `gh auth status` shows authenticated
- [ ] `git` is installed and configured
- [ ] At least one Channel is working (TUI or a Bot)
- [ ] `~/.cueclaw/config.yaml` has valid `ANTHROPIC_API_KEY`
- [ ] A test GitHub repository is available (e.g., `acontext/repo`)

---

## Validation Workflow 1: Issue → Branch → Plan → PR

### User Input (via TUI or Bot)

```
Create a workflow:
Monitor the acontext/repo repository for issues. When an issue's assignee
is set to tiangeng, create a new branch from dev (branch name generated
from issue title), use Claude Code to analyze the issue content and
generate an implementation plan, commit the plan to the new branch,
then create a Draft PR linking the issue, and notify me.
```

### Expected Planner Output

The Planner should dynamically generate something like:

```yaml
name: "Issue Auto PR"
trigger:
  type: poll
  interval_seconds: 60
  diff_mode: new_items
  check_script: |
    gh api repos/acontext/repo/issues \
      --jq '[.[] | select(.assignees[].login == "tiangeng")] | .[].number'

steps:
  - id: clone-repo
    description: "Clone repository and create feature branch from dev"
    agent: claude
    inputs:
      issue_number: "$trigger_data"
    depends_on: []

  - id: analyze-issue
    description: "Read issue content and analyze codebase to generate implementation plan"
    agent: claude
    inputs:
      issue_number: "$trigger_data"
      repo_path: "$steps.clone-repo.output"
    depends_on: [clone-repo]

  - id: create-pr
    description: "Commit PLAN.md and create Draft PR linking the issue"
    agent: claude
    inputs:
      repo_path: "$steps.clone-repo.output"
      plan: "$steps.analyze-issue.output"
    depends_on: [analyze-issue]

  - id: notify
    description: "Notify user about the created PR"
    agent: claude
    inputs:
      pr_info: "$steps.create-pr.output"
    depends_on: [create-pr]
```

### Validation Steps

1. [ ] Submit the workflow description via TUI
2. [ ] Verify Planner generates a reasonable plan with poll trigger and 3–4 steps
3. [ ] Confirm the plan
4. [ ] Verify workflow appears in `cueclaw list` with `executing` phase
5. [ ] Assign an issue to `tiangeng` in the test repo
6. [ ] Wait for the poll trigger to detect the change (up to 60s)
7. [ ] Verify each step executes in order:
   - Branch is created from dev
   - Issue is analyzed and PLAN.md is generated
   - Draft PR is created linking the issue
   - User receives notification
8. [ ] Check the PR exists on GitHub with correct content

### Also validate via Bot

9. [ ] Repeat steps 1–3 via WhatsApp or Telegram Bot
10. [ ] Verify inline keyboard confirmation works
11. [ ] Verify progress notifications arrive on the messaging app

---

## Validation Workflow 2: PR Review Loop

### User Input (via TUI or Bot)

```
Create a workflow:
Monitor PRs I created. If a PR contains PLAN.md, review and refine it.
If someone comments /execute on the PR, start executing the plan and
commit changes. If they comment /modify with a description, update the
plan accordingly. If they comment /merge, squash and merge the PR then
close the linked issue.
```

### Expected Planner Output

The Planner should generate a workflow with conditional branching based on comment content:

```yaml
name: "PR Review Loop"
trigger:
  type: poll
  interval_seconds: 60
  diff_mode: new_items
  check_script: |
    gh api repos/acontext/repo/pulls \
      --jq '[.[] | select(.user.login == "tiangeng")] | .[].number' |
    while read pr; do
      gh api repos/acontext/repo/issues/$pr/comments \
        --jq '.[-1] | select(.body | test("^/(execute|modify|merge)")) | "\($pr):\(.body)"'
    done

steps:
  - id: parse-command
    description: "Parse the trigger data to determine PR number and command"
    agent: claude
    inputs:
      trigger_data: "$trigger_data"
    depends_on: []

  - id: handle-command
    description: >
      Based on the parsed command:
      - /execute: checkout PR branch, read PLAN.md, execute the plan step by step, commit changes
      - /modify <description>: update PLAN.md based on the description, commit
      - /merge: squash merge the PR and close linked issues
    agent: claude
    inputs:
      command_info: "$steps.parse-command.output"
    depends_on: [parse-command]

  - id: notify-result
    description: "Comment on the PR with the result and notify the user"
    agent: claude
    inputs:
      result: "$steps.handle-command.output"
    depends_on: [handle-command]
```

### Validation Steps

1. [ ] Submit the workflow description via TUI or Bot
2. [ ] Verify Planner generates a plan that handles the three commands
3. [ ] Confirm the plan
4. [ ] Create a test PR with a PLAN.md file
5. [ ] Comment `/execute` on the PR → verify agent executes the plan and commits
6. [ ] Comment `/modify add error handling` → verify PLAN.md is updated
7. [ ] Comment `/merge` → verify PR is squash-merged and linked issue is closed
8. [ ] Verify notifications arrive for each action

---

## End-to-End System Validation

Beyond the two workflows, validate these system-level behaviors:

### Daemon Resilience
- [ ] Kill the daemon process (`kill -9 <pid>`) while a workflow is running
- [ ] Verify daemon auto-restarts (via launchd/systemd)
- [ ] Verify interrupted run is marked as failed
- [ ] Verify user receives a notification about the interruption
- [ ] Verify triggers re-register and workflows resume monitoring

### Concurrent Execution
- [ ] Trigger both workflows simultaneously
- [ ] Verify GroupQueue limits concurrent agent calls to the configured cap
- [ ] Verify per-workflow queueing prevents race conditions

### Multi-Channel Consistency
- [ ] Create workflow via TUI, monitor via Telegram Bot
- [ ] Create workflow via Telegram, monitor via TUI Dashboard
- [ ] Verify notifications arrive on all connected Channels

### Error Recovery
- [ ] Test with an invalid `check_script` (e.g., referencing non-existent repo)
- [ ] Verify trigger error is logged but doesn't crash the daemon
- [ ] Test step failure: make a step that will fail (e.g., push to protected branch)
- [ ] Verify failure policy (`stop`) correctly halts execution and skips remaining steps

---

## Acceptance Criteria (MVP Complete)

### Functional
- [ ] Can create both validation workflows via TUI using natural language
- [ ] Can create both validation workflows via Bot (WhatsApp or Telegram) using natural language
- [ ] Planner generates reasonable plans with correct triggers and step dependencies
- [ ] User can confirm, modify, or cancel plans through both TUI and Bot
- [ ] Confirmed workflows run in the background via the daemon
- [ ] Poll triggers correctly detect changes and fire workflow executions
- [ ] Workflow steps execute in correct DAG order
- [ ] Step outputs are passed to dependent steps via `$steps.{id}.output`
- [ ] Users receive notifications for workflow events (start, progress, completion, failure)

### Non-Functional
- [ ] Daemon survives crashes and auto-restarts
- [ ] Interrupted runs are handled gracefully
- [ ] Concurrent workflows don't interfere with each other
- [ ] Logs capture all significant events for debugging
- [ ] Response time: Planner generates a plan within 10–15 seconds
- [ ] Trigger latency: new items detected within one poll interval

---

## Automatable Integration Tests

The manual validation above depends on real GitHub API calls and is not reproducible. The following outlines automatable integration tests:

### Test Fixtures

```typescript
// tests/integration/fixtures.ts
export const mockTriggerData = 'Issue #42: Add login feature'

export const mockPlannerOutput: PlannerOutput = {
  name: 'Test Workflow',
  description: 'Integration test workflow',
  trigger: { type: 'manual' },
  steps: [
    { id: 'step-a', description: 'First step', agent: 'claude', inputs: {}, depends_on: [] },
    { id: 'step-b', description: 'Second step', agent: 'claude', inputs: { prev: '$steps.step-a.output' }, depends_on: ['step-a'] },
    { id: 'step-c', description: 'Third step (parallel with b)', agent: 'claude', inputs: { data: '$trigger_data' }, depends_on: ['step-a'] },
  ],
  failure_policy: { on_step_failure: 'stop', max_retries: 0, retry_delay_ms: 5000 },
}
```

### What to test automatically

| Test | What to Mock | What to Verify |
|------|-----------|----------|
| **Executor DAG ordering** | mock `agent-runner.ts` returns fixed output | step-b and step-c execute in parallel after step-a |
| **$trigger_data resolution** | mock agent runner | step-c receives inputs containing trigger data |
| **$steps.{id}.output resolution** | mock agent runner: step-a returns "result-a" | step-b receives inputs containing "result-a" |
| **Failure policy: stop** | mock agent runner: step-a returns failed | step-b and step-c status is skipped |
| **DB persistence** | in-memory SQLite | workflow_runs and step_runs written correctly |
| **Plan confirmation flow** | mock planner returns mockPlannerOutput | confirm → phase becomes executing, reject → deleted |
| **Trigger evaluation** | mock `execScript` returns changing stdout | trigger correctly detects diff and fires execution |

### Running Tests

```bash
pnpm test                          # Unit tests (fast, no external deps)
pnpm test:integration              # Integration tests (mock agent runner, in-memory DB)
# Manual validation uses real GitHub API — not automated
```

---

## Known Limitations (Acceptable for MVP)

These are known limitations that are acceptable for the MVP and will be addressed in future iterations:

1. **Docker isolation is available** (Phase 2) but optional — `container.enabled` defaults to `false`; local mode uses PreToolUse hooks + allowedTools restrictions
2. **No webhook triggers** — only poll/cron/manual supported
3. **No Web UI** — TUI and Bot only
4. **No HTTP API** — no programmatic access beyond CLI
5. **Single machine** — daemon runs on one machine, no distributed execution
6. **No workflow templates** — each workflow is created from scratch
7. **Session resume is best-effort** — daemon crash may lose in-flight session context
