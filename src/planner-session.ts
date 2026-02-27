import Anthropic from '@anthropic-ai/sdk'
import { nanoid } from 'nanoid'
import { createAnthropicClient } from './anthropic-client.js'
import {
  buildPlannerSystemPrompt,
  plannerCreateWorkflowTool,
  askQuestionTool,
  setSecretTool,
  parsePlannerToolResponse,
} from './planner.js'
import { writeEnvVar, isDev } from './env.js'
import type { Workflow, ChannelContext } from './types.js'
import type { CueclawConfig } from './config.js'
import { logger } from './logger.js'

// ─── Types ───

export interface PlannerSession {
  id: string
  messages: Anthropic.MessageParam[]
  status: 'conversing' | 'plan_ready' | 'cancelled'
  workflow: Workflow | null
}

export interface PlannerTurn {
  type: 'question' | 'plan' | 'text' | 'error'
  content: string
  workflow?: Workflow
}

export interface StreamCallbacks {
  onToken?: (token: string) => void
}

// ─── Session Management ───

export async function startPlannerSession(
  userMessage: string,
  config: CueclawConfig,
  callbacks?: StreamCallbacks,
  channelContext?: ChannelContext,
): Promise<{ session: PlannerSession; turn: PlannerTurn }> {
  const session: PlannerSession = {
    id: `ps_${nanoid()}`,
    messages: [{ role: 'user', content: userMessage }],
    status: 'conversing',
    workflow: null,
  }

  logger.info({ sessionId: session.id }, 'Planner session started')
  const turn = await runPlannerTurn(session, config, callbacks, channelContext)
  return { session, turn }
}

export async function continuePlannerSession(
  session: PlannerSession,
  userMessage: string,
  config: CueclawConfig,
  callbacks?: StreamCallbacks,
  channelContext?: ChannelContext,
): Promise<{ session: PlannerSession; turn: PlannerTurn }> {
  session.messages.push({ role: 'user', content: userMessage })
  logger.debug({ sessionId: session.id, turnCount: session.messages.length }, 'Planner session continued')
  const turn = await runPlannerTurn(session, config, callbacks, channelContext)
  return { session, turn }
}

export function cancelPlannerSession(session: PlannerSession): void {
  session.status = 'cancelled'
  logger.info({ sessionId: session.id }, 'Planner session cancelled')
}

// ─── Internal ───

async function runPlannerTurn(
  session: PlannerSession,
  config: CueclawConfig,
  callbacks?: StreamCallbacks,
  channelContext?: ChannelContext,
): Promise<PlannerTurn> {
  const anthropic = createAnthropicClient(config)
  const systemPrompt = buildPlannerSystemPrompt(config, channelContext) + `

## Conversation Mode

You are in multi-turn conversation mode. You have three tools:

1. **ask_question** — Ask the user clarifying questions when more information is needed.
   Use this when the user's description is vague, missing key details (trigger type, frequency, target repos, filters, output format, etc.), or could be interpreted multiple ways.
   Also use this to ask the user for missing credentials — e.g., "This workflow needs a GITHUB_TOKEN. Could you provide one?"

2. **set_secret** — Store a credential the user provides (e.g., API token, webhook URL).
   Only call this AFTER the user explicitly provides the secret value. Never guess or fabricate values.

3. **create_workflow** — Generate the final workflow plan when you have sufficient information.
   Only use this when you are confident you understand the user's requirements.

Guidelines:
- For simple, clear requests, you may generate the plan immediately.
- For complex or ambiguous requests, ask 1-3 focused questions first.
- If a workflow requires credentials not listed in Available Credentials, ask the user for them before creating the workflow.
- Be concise and helpful in your questions.
- Respond in the same language the user uses.`

  let response: Anthropic.Message
  try {
    if (callbacks?.onToken) {
      // Streaming mode
      const stream = anthropic.messages.stream({
        model: config.claude.planner.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: session.messages,
        tools: [askQuestionTool, setSecretTool, plannerCreateWorkflowTool],
      })

      stream.on('text', (text) => {
        callbacks.onToken?.(text)
      })

      response = await stream.finalMessage()
    } else {
      response = await anthropic.messages.create({
        model: config.claude.planner.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: session.messages,
        tools: [askQuestionTool, setSecretTool, plannerCreateWorkflowTool],
      })
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    logger.error({ err }, 'Planner session API request failed')
    return { type: 'error', content: `API request failed: ${detail}` }
  }

  // OpenRouter error handling
  const rawResponse = response as any
  if (rawResponse.type === 'error' || rawResponse.error) {
    const errMsg = rawResponse.error?.message ?? JSON.stringify(rawResponse.error ?? rawResponse)
    return { type: 'error', content: `API error: ${errMsg}` }
  }

  const result = parsePlannerToolResponse(response)

  // Add assistant response to conversation history
  session.messages.push({ role: 'assistant', content: response.content })

  switch (result.type) {
    case 'question': {
      logger.debug({ sessionId: session.id }, 'Planner asking clarifying question')
      // Add tool result so next turn has proper context
      const toolBlock = response.content.find(b => b.type === 'tool_use' && b.name === 'ask_question')
      if (toolBlock && toolBlock.type === 'tool_use') {
        session.messages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: toolBlock.id, content: 'Question delivered to user. Waiting for response.' }],
        })
      }
      return { type: 'question', content: result.question }
    }

    case 'set_secret': {
      // Persist the secret
      if (isDev) {
        writeEnvVar(result.key, result.value)
      } else {
        process.env[result.key] = result.value
      }
      logger.info({ key: result.key }, 'Secret stored via planner')

      // Add tool_result confirmation so the model can continue
      const secretToolBlock = response.content.find(b => b.type === 'tool_use' && b.name === 'set_secret')
      if (secretToolBlock && secretToolBlock.type === 'tool_use') {
        session.messages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: secretToolBlock.id, content: `Secret ${result.key} saved successfully.` }],
        })
      }

      // Continue — the model may still need to ask more questions or create the workflow
      return runPlannerTurn(session, config, callbacks, channelContext)
    }

    case 'plan': {
      logger.info({ sessionId: session.id }, 'Planner generated plan')
      const now = new Date().toISOString()
      const workflow: Workflow = {
        ...result.plannerOutput,
        schema_version: '1.0',
        id: `wf_${nanoid()}`,
        phase: 'awaiting_confirmation',
        created_at: now,
        updated_at: now,
      }
      session.workflow = workflow
      session.status = 'plan_ready'
      return { type: 'plan', content: `Generated plan: "${workflow.name}"`, workflow }
    }

    case 'text':
      return { type: 'text', content: result.text }

    case 'error':
      logger.error({ sessionId: session.id, error: result.error }, 'Planner session turn error')
      return { type: 'error', content: result.error }
  }
}
