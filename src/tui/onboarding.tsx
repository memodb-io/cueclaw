import { useState, useCallback, useMemo } from 'react'
import { Box, Text, useStdout } from 'ink'
import { TextInput, PasswordInput, ConfirmInput, Spinner, StatusMessage } from '@inkjs/ui'
import { validateAuth } from '../setup-auth.js'
import { checkEnvironment } from '../setup-environment.js'
import { writeConfig, loadConfig, loadExistingConfig, type ExistingConfig } from '../config.js'
import { isDev, writeEnvVar } from '../env.js'
import type { CueclawConfig } from '../config.js'

function maskKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '****' + key.slice(-4)
}

type OnboardingStep =
  | 'welcome'
  | 'api_key_existing'
  | 'api_key'
  | 'base_url_existing'
  | 'base_url'
  | 'validating'
  | 'container_existing'
  | 'container'
  | 'telegram_existing'
  | 'telegram'
  | 'telegram_token_existing'
  | 'telegram_token'
  | 'whatsapp_existing'
  | 'whatsapp'
  | 'saving'
  | 'done'

interface OnboardingState {
  apiKey: string
  baseUrl: string
  containerEnabled: boolean
  telegramEnabled: boolean
  telegramToken: string
  whatsappEnabled: boolean
  validationError?: string
}

interface OnboardingProps {
  onComplete: (config: CueclawConfig) => void
  issues?: import('../config.js').ConfigIssue[]
}

export function Onboarding({ onComplete, issues }: OnboardingProps) {
  const { stdout } = useStdout()
  const cols = stdout?.columns ?? 80

  const existing = useMemo<ExistingConfig>(() => loadExistingConfig(), [])

  // Fix-it mode: determine initial step based on issues
  const initialStep = useMemo<OnboardingStep>(() => {
    if (!issues || issues.length === 0) return 'welcome'
    const errorFields = new Set(issues.filter(i => i.severity === 'error').map(i => i.field))
    // If only API key is missing, skip to API key step
    if (errorFields.size === 1 && errorFields.has('claude.api_key')) {
      return 'api_key'
    }
    // Multiple errors — full wizard
    return 'welcome'
  }, [issues])

  const [step, setStep] = useState<OnboardingStep>(initialStep)
  const [state, setState] = useState<OnboardingState>({
    apiKey: existing.apiKey ?? '',
    baseUrl: existing.baseUrl ?? '',
    containerEnabled: existing.containerEnabled ?? false,
    telegramEnabled: existing.telegramEnabled ?? false,
    telegramToken: existing.telegramToken ?? '',
    whatsappEnabled: existing.whatsappEnabled ?? false,
  })

  const env = checkEnvironment()

  // ─── Navigation helpers ───

  /** Go to the api_key step, showing "existing" prompt if a value is pre-set. */
  const gotoApiKey = useCallback(() => {
    setStep(existing.apiKey ? 'api_key_existing' : 'api_key')
  }, [existing])

  /** Go to the base_url step (dev mode only). */
  const gotoBaseUrl = useCallback(() => {
    if (!isDev) return  // should not be called outside dev
    setStep(existing.baseUrl ? 'base_url_existing' : 'base_url')
  }, [existing])

  /** Go to the container step, or skip it if Docker is not available. */
  const gotoContainer = useCallback(() => {
    if (!(env.docker && env.dockerRunning)) {
      gotoTelegram()
      return
    }
    setStep(existing.containerEnabled !== undefined ? 'container_existing' : 'container')
  }, [env, existing])

  /** Go to the telegram step. */
  const gotoTelegram = useCallback(() => {
    setStep(existing.telegramEnabled !== undefined ? 'telegram_existing' : 'telegram')
  }, [existing])

  /** Go to the telegram token step. */
  const gotoTelegramToken = useCallback(() => {
    setStep(existing.telegramToken ? 'telegram_token_existing' : 'telegram_token')
  }, [existing])

  /** Go to the whatsapp step. */
  const gotoWhatsApp = useCallback(() => {
    setStep(existing.whatsappEnabled !== undefined ? 'whatsapp_existing' : 'whatsapp')
  }, [existing])

  // ─── Step: API Key ───

  /** After validation, continue to the next appropriate step. */
  const afterValidation = useCallback(() => {
    if (env.docker && env.dockerRunning) {
      gotoContainer()
    } else {
      gotoTelegram()
    }
  }, [env, gotoContainer, gotoTelegram])

  const handleApiKeySubmit = useCallback((value: string) => {
    const key = value.trim()
    if (!key) return
    setState(s => ({ ...s, apiKey: key }))
    if (isDev) {
      gotoBaseUrl()
    } else {
      setStep('validating')
      doValidation(key, '')
    }
  }, [gotoBaseUrl])

  // ─── Step: Base URL ───

  const handleBaseUrlSubmit = useCallback((value: string) => {
    const url = value.trim()
    setState(s => ({ ...s, baseUrl: url }))
    setStep('validating')
    doValidation(state.apiKey, url)
  }, [state.apiKey])

  // ─── Validation ───

  const doValidation = useCallback(async (apiKey: string, baseUrl: string) => {
    const prevKey = process.env['ANTHROPIC_API_KEY']
    const prevUrl = process.env['ANTHROPIC_BASE_URL']
    process.env['ANTHROPIC_API_KEY'] = apiKey
    if (baseUrl) {
      process.env['ANTHROPIC_BASE_URL'] = baseUrl
    } else {
      delete process.env['ANTHROPIC_BASE_URL']
    }

    try {
      const tempConfig = loadConfig()
      const result = await validateAuth(tempConfig)
      if (result.valid) {
        setState(s => ({ ...s, validationError: undefined }))
        afterValidation()
      } else {
        setState(s => ({ ...s, validationError: result.error }))
        setStep('api_key')
      }
    } catch {
      setState(s => ({ ...s, validationError: 'Failed to validate API key' }))
      setStep('api_key')
    } finally {
      if (prevKey !== undefined) process.env['ANTHROPIC_API_KEY'] = prevKey
      else delete process.env['ANTHROPIC_API_KEY']
      if (prevUrl !== undefined) process.env['ANTHROPIC_BASE_URL'] = prevUrl
      else delete process.env['ANTHROPIC_BASE_URL']
    }
  }, [afterValidation])

  // ─── Step: Container ───

  const handleContainerYes = useCallback(() => {
    setState(s => ({ ...s, containerEnabled: true }))
    gotoTelegram()
  }, [gotoTelegram])

  const handleContainerNo = useCallback(() => {
    setState(s => ({ ...s, containerEnabled: false }))
    gotoTelegram()
  }, [gotoTelegram])

  // ─── Step: Telegram ───

  const handleTelegramYes = useCallback(() => {
    setState(s => ({ ...s, telegramEnabled: true }))
    gotoTelegramToken()
  }, [gotoTelegramToken])

  const handleTelegramNo = useCallback(() => {
    setState(s => ({ ...s, telegramEnabled: false }))
    gotoWhatsApp()
  }, [gotoWhatsApp])

  const handleTelegramTokenSubmit = useCallback((value: string) => {
    setState(s => ({ ...s, telegramToken: value.trim() }))
    gotoWhatsApp()
  }, [gotoWhatsApp])

  // ─── Step: WhatsApp ───

  const finishWithWhatsApp = useCallback((enabled: boolean) => {
    const next = { ...state, whatsappEnabled: enabled }
    setState(s => ({ ...s, whatsappEnabled: enabled }))
    setStep('saving')
    doSaveConfig(next)
  }, [state])

  const handleWhatsAppYes = useCallback(() => finishWithWhatsApp(true), [finishWithWhatsApp])
  const handleWhatsAppNo = useCallback(() => finishWithWhatsApp(false), [finishWithWhatsApp])

  // ─── Save Config ───

  const doSaveConfig = useCallback((finalState: OnboardingState) => {
    if (isDev) {
      // Dev mode: only write to .env, never touch config.yaml
      writeEnvVar('ANTHROPIC_API_KEY', finalState.apiKey)
      if (finalState.baseUrl) {
        writeEnvVar('ANTHROPIC_BASE_URL', finalState.baseUrl)
      }
    } else {
      // Production mode: write to config.yaml
      const configUpdates: Record<string, any> = {
        claude: {
          api_key: finalState.apiKey,
          ...(finalState.baseUrl ? { base_url: finalState.baseUrl } : {}),
        },
      }

      if (finalState.containerEnabled) {
        configUpdates.container = { enabled: true }
      }

      if (finalState.telegramEnabled && finalState.telegramToken) {
        configUpdates.telegram = {
          enabled: true,
          token: finalState.telegramToken,
        }
      }

      if (finalState.whatsappEnabled) {
        configUpdates.whatsapp = { enabled: true }
      }

      writeConfig(configUpdates)
    }

    const config = loadConfig()
    setStep('done')
    setTimeout(() => onComplete(config), 1500)
  }, [onComplete])

  // ─── Render ───

  /** Helper: wraps a step with content on top (flexGrow) and input pinned at bottom */
  const StepLayout = ({ children, input }: { children: React.ReactNode; input: React.ReactNode }) => (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" flexGrow={1}>{children}</Box>
      <Box marginTop={1}>{input}</Box>
    </Box>
  )

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      {/* ── Welcome ── */}
      {step === 'welcome' && (
        <StepLayout
          input={
            <TextInput
              placeholder="Press Enter to continue..."
              onSubmit={() => gotoApiKey()}
            />
          }
        >
          <Text bold color="cyan">Welcome to CueClaw</Text>
          <Text bold>First time? Let's set up CueClaw.</Text>
          <Text dimColor>{'─'.repeat(Math.max(0, cols - 2))}</Text>
          <Box marginTop={1}>
            <Text>Press </Text>
            <Text bold color="green">Enter</Text>
            <Text> to begin setup</Text>
          </Box>
        </StepLayout>
      )}

      {/* ── API Key (existing) ── */}
      {step === 'api_key_existing' && (
        <StepLayout
          input={
            <ConfirmInput
              onConfirm={() => {
                if (isDev) gotoBaseUrl()
                else {
                  setStep('validating')
                  doValidation(state.apiKey, state.baseUrl)
                }
              }}
              onCancel={() => setStep('api_key')}
            />
          }
        >
          <Text bold>Step 1: API Key</Text>
          <Text>Found existing API key: <Text color="yellow">{maskKey(existing.apiKey!)}</Text></Text>
          <Text dimColor>Keep this key?</Text>
        </StepLayout>
      )}

      {/* ── API Key (input) ── */}
      {step === 'api_key' && (
        <StepLayout
          input={
            <Box>
              <Text color="green">{'> '}</Text>
              <PasswordInput placeholder="sk-ant-..." onSubmit={handleApiKeySubmit} />
            </Box>
          }
        >
          <Text bold>Step 1: API Key</Text>
          <Text dimColor>Enter your Anthropic API key (or compatible provider key)</Text>
          {state.validationError && (
            <Box marginY={1}>
              <StatusMessage variant="error">{state.validationError}</StatusMessage>
            </Box>
          )}
        </StepLayout>
      )}

      {/* ── Base URL (existing) ── */}
      {step === 'base_url_existing' && (
        <StepLayout
          input={
            <ConfirmInput
              onConfirm={() => {
                setStep('validating')
                doValidation(state.apiKey, state.baseUrl)
              }}
              onCancel={() => setStep('base_url')}
            />
          }
        >
          <Text bold>Step 1b: Base URL</Text>
          <Text>Found existing base URL: <Text color="yellow">{existing.baseUrl}</Text></Text>
          <Text dimColor>Keep this URL?</Text>
        </StepLayout>
      )}

      {/* ── Base URL (input) ── */}
      {step === 'base_url' && (
        <StepLayout
          input={
            <Box>
              <Text color="green">{'> '}</Text>
              <TextInput placeholder="https://api.anthropic.com" onSubmit={handleBaseUrlSubmit} />
            </Box>
          }
        >
          <Text bold>Step 1b: Base URL (optional)</Text>
          <Text dimColor>Custom API base URL (leave empty for api.anthropic.com)</Text>
        </StepLayout>
      )}

      {/* ── Validating ── */}
      {step === 'validating' && (
        <Box flexDirection="column" flexGrow={1}>
          <Spinner label="Validating API key..." />
        </Box>
      )}

      {/* ── Container (existing) ── */}
      {step === 'container_existing' && (
        <StepLayout
          input={
            <ConfirmInput
              onConfirm={() => gotoTelegram()}
              onCancel={() => setStep('container')}
            />
          }
        >
          <Text bold>Step 2: Container Isolation</Text>
          <Text>Container isolation is already <Text color="yellow">{existing.containerEnabled ? 'enabled' : 'disabled'}</Text>.</Text>
          <Text dimColor>Keep this setting?</Text>
        </StepLayout>
      )}

      {/* ── Container (input) ── */}
      {step === 'container' && (
        <StepLayout
          input={<ConfirmInput onConfirm={handleContainerYes} onCancel={handleContainerNo} />}
        >
          <Text bold>Step 2: Container Isolation</Text>
          <Text dimColor>Docker detected. Enable container isolation for safer execution?</Text>
        </StepLayout>
      )}

      {/* ── Telegram (existing) ── */}
      {step === 'telegram_existing' && (
        <StepLayout
          input={
            <ConfirmInput
              onConfirm={() => {
                if (state.telegramEnabled) gotoTelegramToken()
                else gotoWhatsApp()
              }}
              onCancel={() => setStep('telegram')}
            />
          }
        >
          <Text bold>Step 3: Telegram Bot</Text>
          <Text>Telegram bot is already <Text color="yellow">{existing.telegramEnabled ? 'enabled' : 'disabled'}</Text>.</Text>
          <Text dimColor>Keep this setting?</Text>
        </StepLayout>
      )}

      {/* ── Telegram (input) ── */}
      {step === 'telegram' && (
        <StepLayout
          input={<ConfirmInput onConfirm={handleTelegramYes} onCancel={handleTelegramNo} />}
        >
          <Text bold>Step 3: Telegram Bot</Text>
          <Text dimColor>Set up a Telegram bot for remote workflow management?</Text>
        </StepLayout>
      )}

      {/* ── Telegram Token (existing) ── */}
      {step === 'telegram_token_existing' && (
        <StepLayout
          input={
            <ConfirmInput
              onConfirm={() => gotoWhatsApp()}
              onCancel={() => setStep('telegram_token')}
            />
          }
        >
          <Text bold>Telegram Bot Token</Text>
          <Text>Found existing token: <Text color="yellow">{maskKey(existing.telegramToken!)}</Text></Text>
          <Text dimColor>Keep this token?</Text>
        </StepLayout>
      )}

      {/* ── Telegram Token (input) ── */}
      {step === 'telegram_token' && (
        <StepLayout
          input={
            <Box>
              <Text color="green">{'> '}</Text>
              <PasswordInput placeholder="123456:ABC..." onSubmit={handleTelegramTokenSubmit} />
            </Box>
          }
        >
          <Text bold>Telegram Bot Token</Text>
          <Text dimColor>Paste the token from @BotFather</Text>
        </StepLayout>
      )}

      {/* ── WhatsApp (existing) ── */}
      {step === 'whatsapp_existing' && (
        <StepLayout
          input={
            <ConfirmInput
              onConfirm={() => finishWithWhatsApp(state.whatsappEnabled)}
              onCancel={() => setStep('whatsapp')}
            />
          }
        >
          <Text bold>Step 4: WhatsApp</Text>
          <Text>WhatsApp is already <Text color="yellow">{existing.whatsappEnabled ? 'enabled' : 'disabled'}</Text>.</Text>
          <Text dimColor>Keep this setting?</Text>
        </StepLayout>
      )}

      {/* ── WhatsApp (input) ── */}
      {step === 'whatsapp' && (
        <StepLayout
          input={<ConfirmInput onConfirm={handleWhatsAppYes} onCancel={handleWhatsAppNo} />}
        >
          <Text bold>Step 4: WhatsApp</Text>
          <Text dimColor>Enable WhatsApp channel? (Requires QR scan on daemon start)</Text>
        </StepLayout>
      )}

      {/* ── Saving ── */}
      {step === 'saving' && (
        <Box flexDirection="column" flexGrow={1}>
          <Spinner label="Saving configuration..." />
        </Box>
      )}

      {/* ── Done ── */}
      {step === 'done' && (
        <Box flexDirection="column" flexGrow={1}>
          <StatusMessage variant="success">Configuration saved!</StatusMessage>
          <Box flexDirection="column" marginTop={1} marginLeft={2}>
            <Text dimColor>API Key: ****{state.apiKey.slice(-4)}</Text>
            {state.baseUrl && <Text dimColor>Base URL: {state.baseUrl}</Text>}
            {state.containerEnabled && <Text dimColor>Container isolation: enabled</Text>}
            {state.telegramEnabled && <Text dimColor>Telegram bot: configured</Text>}
            {state.whatsappEnabled && <Text dimColor>WhatsApp: enabled</Text>}
          </Box>
          <Box marginTop={1}>
            <Text>Starting CueClaw...</Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}
