import { Box, Text } from 'ink'
import { TextInput, Spinner, useComponentTheme, type ComponentTheme } from '@inkjs/ui'

interface ChatMessage {
  role: 'user' | 'system'
  text: string
}

interface ChatProps {
  messages: ChatMessage[]
  isGenerating: boolean
  onSubmit: (text: string) => void
}

export function Chat({ messages, isGenerating, onSubmit }: ChatProps) {
  const { styles } = useComponentTheme<ComponentTheme>('Chat')
  const userStyle = styles?.userMessage?.() ?? { color: 'white', bold: true }
  const systemStyle = styles?.systemMessage?.() ?? { color: 'cyan' }
  const promptStyle = styles?.prompt?.() ?? { color: 'green' }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {messages.map((msg, i) => (
          <Box key={i} marginBottom={1}>
            {msg.role === 'user' ? (
              <Text {...userStyle}>You: {msg.text}</Text>
            ) : (
              <Text {...systemStyle}>CueClaw: {msg.text}</Text>
            )}
          </Box>
        ))}
        {isGenerating && (
          <Box>
            <Spinner label="Generating plan..." />
          </Box>
        )}
      </Box>

      {!isGenerating && (
        <Box paddingX={1}>
          <Text {...promptStyle}>{'> '}</Text>
          <TextInput
            placeholder="Describe your workflow..."
            onSubmit={(value) => {
              if (value.trim()) onSubmit(value.trim())
            }}
          />
        </Box>
      )}
    </Box>
  )
}

export type { ChatMessage }
