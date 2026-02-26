import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod/v4'
import { nanoid } from 'nanoid'
import { validateDAG } from './workflow.js'
import { createAnthropicClient } from './anthropic-client.js'
import { PlannerError } from './types.js'
import type { Workflow, PlannerOutput } from './types.js'
import type { CueclawConfig } from './config.js'
import { getConfiguredSecretKeys } from './env.js'
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

// ─── Ask Question Tool ───

export const askQuestionTool: Anthropic.Tool = {
  name: 'ask_question',
  description: 'Ask the user a clarifying question to gather more information before creating a workflow. Use this when the user description is ambiguous or missing key details such as trigger frequency, specific repositories, filters, output format, etc.',
  input_schema: {
    type: 'object' as const,
    required: ['question'],
    properties: {
      question: { type: 'string', description: 'The question to ask the user' },
    },
  },
}

// ─── Set Secret Tool ───

export const setSecretTool: Anthropic.Tool = {
  name: 'set_secret',
  description: 'Store a secret/credential provided by the user (e.g., API token, webhook URL). The value will be saved to the environment for use by workflow steps. Only call this after the user explicitly provides the secret value.',
  input_schema: {
    type: 'object' as const,
    required: ['key', 'value'],
    properties: {
      key: { type: 'string', description: 'Environment variable name in UPPER_SNAKE_CASE (e.g., GITHUB_TOKEN)' },
      value: { type: 'string', description: 'The secret value provided by the user' },
    },
  },
}

// ─── Exported building blocks ───

export { PlannerOutputSchema }
export { plannerTool as plannerCreateWorkflowTool }

/** Parse a tool_use response from the planner, validating the workflow output */
export function parsePlannerToolResponse(
  response: Anthropic.Message,
): { type: 'question'; question: string } | { type: 'plan'; plannerOutput: PlannerOutput } | { type: 'set_secret'; key: string; value: string } | { type: 'text'; text: string } | { type: 'error'; error: string } {
  if (!response.content || !Array.isArray(response.content)) {
    return { type: 'error', error: 'Unexpected API response: no content array' }
  }

  // Check for ask_question tool
  const askBlock = response.content.find(b => b.type === 'tool_use' && b.name === 'ask_question')
  if (askBlock && askBlock.type === 'tool_use') {
    const question = (askBlock.input as any)?.question
    return { type: 'question', question: question ?? 'Could you provide more details?' }
  }

  // Check for set_secret tool
  const secretBlock = response.content.find(b => b.type === 'tool_use' && b.name === 'set_secret')
  if (secretBlock && secretBlock.type === 'tool_use') {
    const input = secretBlock.input as any
    return { type: 'set_secret', key: input.key, value: input.value }
  }

  // Check for create_workflow tool
  const toolBlock = response.content.find(b => b.type === 'tool_use' && b.name === 'create_workflow')
  if (toolBlock && toolBlock.type === 'tool_use') {
    const parseResult = PlannerOutputSchema.safeParse(toolBlock.input)
    if (!parseResult.success) {
      const errMsg = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
      return { type: 'error', error: `Invalid plan: ${errMsg}` }
    }

    const dagErrors = validateDAG(parseResult.data.steps)
    if (dagErrors.length > 0) {
      return { type: 'error', error: `DAG validation failed: ${dagErrors.join(', ')}` }
    }

    return { type: 'plan', plannerOutput: parseResult.data }
  }

  // Fallback: extract text content
  const textBlocks = response.content.filter(b => b.type === 'text')
  if (textBlocks.length > 0) {
    const text = textBlocks.map(b => b.type === 'text' ? b.text : '').join('\n')
    return { type: 'text', text }
  }

  return { type: 'error', error: 'Unexpected planner response format' }
}

// ─── System Prompt ───

export function buildPlannerSystemPrompt(config: CueclawConfig): string {
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

## Available Credentials

${(() => {
  const keys = getConfiguredSecretKeys()
  if (keys.length > 0) {
    return `The following credentials are configured: ${keys.join(', ')}\nYou can reference these in workflow steps — they are available as environment variables.`
  }
  return 'No credentials are currently configured.'
})()}

If a workflow needs credentials not listed above, use the set_secret tool to store them after the user provides the value. Never invent or guess secret values.

## User Identity
${identity}`
}

// ─── Generate Plan ───

export async function generatePlan(
  userDescription: string,
  config: CueclawConfig,
): Promise<Workflow> {
  const anthropic = createAnthropicClient(config)
  const MAX_RETRIES = 2
  let retryContext = ''

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const prompt = retryContext
      ? `${userDescription}\n\n${retryContext}`
      : userDescription

    logger.debug({ attempt, hasRetryContext: !!retryContext }, 'Planner attempt')

    let response: Anthropic.Message
    try {
      response = await anthropic.messages.create({
        model: config.claude.planner.model,
        max_tokens: 4096,
        system: buildPlannerSystemPrompt(config),
        messages: [{ role: 'user', content: prompt }],
        tools: [plannerTool],
        tool_choice: { type: 'tool', name: 'create_workflow' },
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new PlannerError(
        `API request failed: ${detail}. Check your API key and base_url in ~/.cueclaw/config.yaml`
      )
    }

    // OpenRouter and other proxies may return error objects instead of proper Anthropic responses
    const rawResponse = response as any
    if (rawResponse.type === 'error' || rawResponse.error) {
      const errMsg = rawResponse.error?.message ?? JSON.stringify(rawResponse.error ?? rawResponse)
      throw new PlannerError(`API error: ${errMsg}`)
    }

    if (!response.content || !Array.isArray(response.content)) {
      logger.debug({ response: JSON.stringify(response).slice(0, 500) }, 'Unexpected API response shape')
      throw new PlannerError(
        `Unexpected API response (no content array). ` +
        `This may indicate an issue with your API provider. ` +
        `Response: ${JSON.stringify(response).slice(0, 200)}`
      )
    }

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
