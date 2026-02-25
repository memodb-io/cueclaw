import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod/v4'
import { nanoid } from 'nanoid'
import { validateDAG } from './workflow.js'
import { PlannerError } from './types.js'
import type { Workflow, PlannerOutput } from './types.js'
import type { CueclawConfig } from './config.js'
import { logger } from './logger.js'

// ─── PlannerOutput Zod Schema ───

const PlanStepSchema = z.object({
  id: z.string(),
  description: z.string(),
  expected_output: z.string().optional(),
  agent: z.literal('claude'),
  inputs: z.record(z.string(), z.any()),
  depends_on: z.array(z.string()),
})

const TriggerConfigSchema = z.union([
  z.object({
    type: z.literal('poll'),
    interval_seconds: z.number(),
    check_script: z.string(),
    diff_mode: z.enum(['new_items', 'any_change']),
  }),
  z.object({
    type: z.literal('cron'),
    expression: z.string(),
    timezone: z.string().optional(),
  }),
  z.object({ type: z.literal('manual') }),
])

const FailurePolicySchema = z.object({
  on_step_failure: z.enum(['stop', 'skip_dependents', 'ask_user']),
  max_retries: z.number(),
  retry_delay_ms: z.number(),
})

const PlannerOutputSchema = z.object({
  name: z.string(),
  description: z.string(),
  trigger: TriggerConfigSchema,
  steps: z.array(PlanStepSchema).min(1),
  failure_policy: FailurePolicySchema,
})

// ─── Tool Definition (JSON Schema for Anthropic API) ───

const plannerOutputJsonSchema: Anthropic.Tool['input_schema'] = {
  type: 'object' as const,
  required: ['name', 'description', 'trigger', 'steps', 'failure_policy'],
  properties: {
    name: { type: 'string', description: 'Short workflow name' },
    description: { type: 'string', description: "User's original natural language description" },
    trigger: {
      type: 'object',
      description: 'Trigger configuration',
      properties: {
        type: { type: 'string', enum: ['poll', 'cron', 'manual'] },
        interval_seconds: { type: 'number' },
        check_script: { type: 'string' },
        diff_mode: { type: 'string', enum: ['new_items', 'any_change'] },
        expression: { type: 'string' },
        timezone: { type: 'string' },
      },
      required: ['type'],
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'description', 'agent', 'inputs', 'depends_on'],
        properties: {
          id: { type: 'string', description: 'kebab-case step ID' },
          description: { type: 'string', description: 'Detailed step description for the agent' },
          expected_output: { type: 'string' },
          agent: { type: 'string', enum: ['claude'] },
          inputs: { type: 'object', description: 'Step inputs, may use $steps.{id}.output or $trigger_data' },
          depends_on: { type: 'array', items: { type: 'string' }, description: 'Step IDs this step depends on' },
        },
      },
      minItems: 1,
    },
    failure_policy: {
      type: 'object',
      required: ['on_step_failure', 'max_retries', 'retry_delay_ms'],
      properties: {
        on_step_failure: { type: 'string', enum: ['stop', 'skip_dependents', 'ask_user'] },
        max_retries: { type: 'number' },
        retry_delay_ms: { type: 'number' },
      },
    },
  },
}

const plannerTool: Anthropic.Tool = {
  name: 'create_workflow',
  description: 'Create a workflow definition from the user description. Generate steps as a DAG with proper dependencies.',
  input_schema: plannerOutputJsonSchema,
}

// ─── System Prompt ───

function buildPlannerSystemPrompt(config: CueclawConfig): string {
  const identity = config.identity?.name ? `\nUser identity: ${config.identity.name}` : ''

  return `You are CueClaw Planner. Convert user's natural language into a structured Workflow.

## Execution Environment

All steps are executed by the Claude Agent SDK. The agent has Bash and can use
any CLI tool installed locally. It auto-loads .claude/skills/.
You don't need to verify tool availability — the agent detects at runtime.

## Rules

1. Every step's agent field is "claude" (Claude Agent SDK execution)
2. Step description uses natural language — the agent decides which tools to use
3. depends_on must reference defined step IDs, forming a valid DAG (no cycles)
4. Step IDs use kebab-case: "fetch-issues", "create-branch"
5. Use $steps.{id}.output in inputs to reference prior step results
6. Use $trigger_data in inputs to reference the trigger's output data
7. Do NOT generate position, phase, schema_version, status, or timestamp fields (framework auto-fills). You MUST generate step id fields.
8. Trigger check_script can use any shell commands
9. Step description should be detailed enough for the agent to execute independently — not just a one-line summary
10. Input keys use snake_case (e.g., issue_number, repo_path)
11. Steps must NOT include a status field — the framework sets all steps to pending automatically
12. Step output is a plain text string — downstream agents parse structure themselves

## User Identity
${identity}`
}

// ─── Generate Plan ───

export async function generatePlan(
  userDescription: string,
  config: CueclawConfig,
): Promise<Workflow> {
  const anthropic = new Anthropic({ apiKey: config.claude.api_key })
  const MAX_RETRIES = 2
  let retryContext = ''

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const prompt = retryContext
      ? `${userDescription}\n\n${retryContext}`
      : userDescription

    logger.debug({ attempt, hasRetryContext: !!retryContext }, 'Planner attempt')

    const response = await anthropic.messages.create({
      model: config.claude.planner.model,
      max_tokens: 4096,
      system: buildPlannerSystemPrompt(config),
      messages: [{ role: 'user', content: prompt }],
      tools: [plannerTool],
      tool_choice: { type: 'tool', name: 'create_workflow' },
    })

    const toolBlock = response.content.find(b => b.type === 'tool_use')
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      throw new PlannerError('Unexpected planner response format: no tool_use block')
    }

    const parseResult = PlannerOutputSchema.safeParse(toolBlock.input)
    if (!parseResult.success) {
      const errMsg = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
      if (attempt < MAX_RETRIES) {
        retryContext = `[System] Previous plan had validation issues:\n${errMsg}\nPlease fix and try again.`
        continue
      }
      throw new PlannerError(`Invalid plan after ${MAX_RETRIES + 1} attempts: ${errMsg}`)
    }

    const dagErrors = validateDAG(parseResult.data.steps)
    if (dagErrors.length > 0) {
      if (attempt < MAX_RETRIES) {
        retryContext = `[System] DAG dependency issues:\n${dagErrors.join('\n')}\nPlease fix the step dependencies.`
        continue
      }
      throw new PlannerError(`DAG validation failed after ${MAX_RETRIES + 1} attempts: ${dagErrors.join(', ')}`)
    }

    const now = new Date().toISOString()
    return {
      ...parseResult.data,
      schema_version: '1.0',
      id: `wf_${nanoid()}`,
      phase: 'awaiting_confirmation',
      created_at: now,
      updated_at: now,
    }
  }

  throw new PlannerError('Failed to generate valid plan after retries')
}

// ─── Modify Plan ───

export async function modifyPlan(
  originalWorkflow: Workflow,
  modificationDescription: string,
  config: CueclawConfig,
): Promise<Workflow> {
  const plannerOutput: PlannerOutput = {
    name: originalWorkflow.name,
    description: originalWorkflow.description,
    trigger: originalWorkflow.trigger,
    steps: originalWorkflow.steps,
    failure_policy: originalWorkflow.failure_policy,
  }

  const combinedPrompt = `Here is the current workflow plan:
\`\`\`json
${JSON.stringify(plannerOutput, null, 2)}
\`\`\`

The user wants to modify it as follows:
${modificationDescription}

Preserve unmodified steps' IDs, descriptions, and dependencies — only change what the user specified.
Return the complete modified workflow using the create_workflow tool.`

  const result = await generatePlan(combinedPrompt, config)
  // Keep original ID but update timestamp
  return {
    ...result,
    id: originalWorkflow.id,
    updated_at: new Date().toISOString(),
  }
}

// ─── Plan Confirmation ───

export function confirmPlan(workflow: Workflow): Workflow {
  if (workflow.phase !== 'awaiting_confirmation') {
    throw new PlannerError(`Cannot confirm workflow in phase "${workflow.phase}"`)
  }

  const nextPhase = workflow.trigger.type === 'manual' ? 'executing' : 'active'
  return {
    ...workflow,
    phase: nextPhase,
    updated_at: new Date().toISOString(),
  }
}

export function rejectPlan(workflow: Workflow): Workflow {
  return {
    ...workflow,
    phase: 'planning',
    updated_at: new Date().toISOString(),
  }
}
