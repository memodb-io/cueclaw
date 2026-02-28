import { describe, it, expect } from 'vitest'
import { parsePlannerToolResponse } from './planner.js'
import type Anthropic from '@anthropic-ai/sdk'

// Test the parsePlannerToolResponse function which is the core of planner-session logic

describe('parsePlannerToolResponse', () => {
  it('parses ask_question tool response', () => {
    const response: Anthropic.Message = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-6',
      content: [
        {
          type: 'tool_use',
          id: 'tu_123',
          name: 'ask_question',
          input: { question: 'Which repository?' },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 },
    }

    const result = parsePlannerToolResponse(response)
    expect(result.type).toBe('question')
    if (result.type === 'question') {
      expect(result.question).toBe('Which repository?')
    }
  })

  it('parses create_workflow tool response', () => {
    const response: Anthropic.Message = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-6',
      content: [
        {
          type: 'tool_use',
          id: 'tu_123',
          name: 'create_workflow',
          input: {
            name: 'Test Workflow',
            description: 'A test',
            trigger: { type: 'manual' },
            steps: [
              { id: 'step-1', description: 'Do something', agent: 'claude', inputs: {}, depends_on: [] },
            ],
            failure_policy: { on_step_failure: 'stop', max_retries: 0, retry_delay_ms: 0 },
          },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 200 },
    }

    const result = parsePlannerToolResponse(response)
    expect(result.type).toBe('plan')
    if (result.type === 'plan') {
      expect(result.plannerOutput.name).toBe('Test Workflow')
      expect(result.plannerOutput.steps).toHaveLength(1)
    }
  })

  it('returns error for invalid workflow schema', () => {
    const response: Anthropic.Message = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-6',
      content: [
        {
          type: 'tool_use',
          id: 'tu_123',
          name: 'create_workflow',
          input: {
            name: 'Test',
            // missing required fields
          },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 },
    }

    const result = parsePlannerToolResponse(response)
    expect(result.type).toBe('error')
  })

  it('extracts text from text blocks', () => {
    const response: Anthropic.Message = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-6',
      content: [
        { type: 'text', text: 'Here is some explanation.' },
      ],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 20 },
    }

    const result = parsePlannerToolResponse(response)
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.text).toBe('Here is some explanation.')
    }
  })

  it('returns error for empty content', () => {
    const response = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-6',
      content: null,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 0 },
    } as unknown as Anthropic.Message

    const result = parsePlannerToolResponse(response)
    expect(result.type).toBe('error')
  })

  it('returns error for DAG cycle', () => {
    const response: Anthropic.Message = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-6',
      content: [
        {
          type: 'tool_use',
          id: 'tu_123',
          name: 'create_workflow',
          input: {
            name: 'Cycle Test',
            description: 'Test',
            trigger: { type: 'manual' },
            steps: [
              { id: 'a', description: 'A', agent: 'claude', inputs: {}, depends_on: ['b'] },
              { id: 'b', description: 'B', agent: 'claude', inputs: {}, depends_on: ['a'] },
            ],
            failure_policy: { on_step_failure: 'stop', max_retries: 0, retry_delay_ms: 0 },
          },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 200 },
    }

    const result = parsePlannerToolResponse(response)
    expect(result.type).toBe('error')
    if (result.type === 'error') {
      expect(result.error).toContain('DAG')
    }
  })

  it('parses set_secret tool response', () => {
    const response: Anthropic.Message = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-6',
      content: [
        {
          type: 'tool_use',
          id: 'tu_123',
          name: 'set_secret',
          input: { key: 'GITHUB_TOKEN', value: 'ghp_abc123' },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 },
    }

    const result = parsePlannerToolResponse(response)
    expect(result.type).toBe('set_secret')
    if (result.type === 'set_secret') {
      expect(result.key).toBe('GITHUB_TOKEN')
      expect(result.value).toBe('ghp_abc123')
    }
  })

  it('prefers ask_question over set_secret when both present', () => {
    const response: Anthropic.Message = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-6',
      content: [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'ask_question',
          input: { question: 'What token?' },
        },
        {
          type: 'tool_use',
          id: 'tu_2',
          name: 'set_secret',
          input: { key: 'GITHUB_TOKEN', value: 'ghp_abc' },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 100 },
    }

    const result = parsePlannerToolResponse(response)
    expect(result.type).toBe('question')
  })

  it('prefers ask_question over create_workflow when both present', () => {
    const response: Anthropic.Message = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-6',
      content: [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'ask_question',
          input: { question: 'Need more info' },
        },
        {
          type: 'tool_use',
          id: 'tu_2',
          name: 'create_workflow',
          input: {
            name: 'Test',
            description: 'desc',
            trigger: { type: 'manual' },
            steps: [{ id: 's1', description: 'd', agent: 'claude', inputs: {}, depends_on: [] }],
            failure_policy: { on_step_failure: 'stop', max_retries: 0, retry_delay_ms: 0 },
          },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 200 },
    }

    const result = parsePlannerToolResponse(response)
    expect(result.type).toBe('question')
  })
})
