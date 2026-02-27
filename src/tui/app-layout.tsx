import { useMemo } from 'react'
import { Box, Static, useStdout } from 'ink'
import { Banner } from './banner.js'
import { Chat } from './chat.js'
import { PlanView } from './plan-view.js'
import { ExecutionView } from './execution-view.js'
import { WorkflowDetailView } from './workflow-detail-view.js'
import { Onboarding } from './onboarding.js'
import { Status } from './status.js'
import { useUIState } from './ui-state-context.js'
import { useUIActions } from './ui-actions-context.js'
import { appVersion } from './version.js'
import { validateConfig } from '../config.js'

export function AppLayout({ cwd }: { cwd: string }) {
  const { view, workflow, stepProgress, executionOutput, config, statusWorkflows, detailRuns, detailStepRuns } = useUIState()
  const { handleConfirm, handleModify, handleCancel, handleExecutionAbort, handleExecutionBack, handleOnboardingComplete, handleOnboardingCancel, handleStatusBack, handleStatusSelect, handleStatusStop, handleStatusDelete, handleDetailBack, handleDetailSelectRun } = useUIActions()
  const { stdout } = useStdout()

  const rows = stdout?.rows ?? 24
  const displayPath = cwd ? cwd.replace(process.env['HOME'] ?? '', '~') : ''
  const versionLabel = appVersion === 'dev' ? 'dev' : `v${appVersion}`

  const configIssues = useMemo(() => {
    const validation = validateConfig()
    return validation.issues.filter(i => i.severity === 'error')
  }, [])

  return (
    <Box flexDirection="column" height={rows}>
      {/* Title */}
      <Static items={view !== 'onboarding' ? ['banner'] : []}>
        {(item) => (
          <Banner
            key={item}
            version={versionLabel}
            cwd={displayPath}
            terminalWidth={stdout?.columns ?? 80}
          />
        )}
      </Static>

      {view === 'onboarding' && (
        <Onboarding onComplete={handleOnboardingComplete} onCancel={config ? handleOnboardingCancel : undefined} issues={configIssues} />
      )}
      {view === 'chat' && (
        <Chat />
      )}
      {view === 'plan' && workflow && (
        <PlanView
          workflow={workflow}
          onConfirm={handleConfirm}
          onModify={handleModify}
          onCancel={handleCancel}
        />
      )}
      {view === 'execution' && workflow && (
        <ExecutionView
          workflow={workflow}
          stepProgress={stepProgress}
          output={executionOutput}
          onBack={handleExecutionBack}
          onAbort={handleExecutionAbort}
        />
      )}
      {view === 'status' && (
        <Status
          workflows={statusWorkflows}
          onBack={handleStatusBack}
          onSelect={handleStatusSelect}
          onStop={handleStatusStop}
          onDelete={handleStatusDelete}
        />
      )}
      {view === 'detail' && workflow && (
        <WorkflowDetailView
          workflow={workflow}
          runs={detailRuns}
          latestStepRuns={detailStepRuns}
          onBack={handleDetailBack}
          onSelectRun={handleDetailSelectRun}
        />
      )}
    </Box>
  )
}
