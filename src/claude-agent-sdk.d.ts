declare module '@anthropic-ai/claude-agent-sdk' {
  interface QueryOptions {
    cwd?: string
    model?: string
    resume?: string
    allowedTools?: string[]
    settingSources?: string[]
    permissionMode?: string
    mcpServers?: Record<string, any>
    maxTurns?: number
    hooks?: Record<string, any>
  }

  interface QueryInput {
    prompt: string | AsyncIterable<any>
    options?: QueryOptions
  }

  interface SDKMessage {
    type: string
    subtype?: string
    session_id?: string
    content?: any[]
    message?: any
    result?: string
    [key: string]: any
  }

  type Query = AsyncIterable<SDKMessage> & {
    interrupt?: () => void
  }

  export function query(input: QueryInput): Query
}
