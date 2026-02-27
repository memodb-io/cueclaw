import type { ChatMessage } from '../ui-state-context.js'
import { UserMessage } from './user-message.js'
import { AssistantMessage } from './assistant-message.js'
import { AssistantJsxMessage } from './assistant-jsx-message.js'
import { SystemMessage } from './system-message.js'
import { ErrorMessage } from './error-message.js'
import { WarningMessage } from './warning-message.js'
import { PlanReadyMessage } from './plan-ready-message.js'

export function MessageDisplay({ message }: { message: ChatMessage }) {
  switch (message.type) {
    case 'user':
      return <UserMessage text={message.text} />
    case 'assistant':
      return <AssistantMessage text={message.text} />
    case 'assistant-jsx':
      return <AssistantJsxMessage content={message.content} />
    case 'system':
      return <SystemMessage text={message.text} />
    case 'error':
      return <ErrorMessage text={message.text} />
    case 'warning':
      return <WarningMessage text={message.text} />
    case 'plan-ready':
      return <PlanReadyMessage workflowName={message.workflowName} />
  }
}
