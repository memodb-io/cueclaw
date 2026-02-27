import { registerCommand } from './registry.js'
import { getWorkflow, listWorkflows, updateWorkflowPhase } from '../../db.js'

registerCommand({
  name: 'resume',
  aliases: [],
  description: 'Resume a paused workflow',
  usage: '/resume <id>',
  execute(args, ctx) {
    if (!args) {
      ctx.addMessage({ type: 'assistant', text: 'Usage: /resume <workflow-id>' })
      return
    }
    const wf = getWorkflow(ctx.db, args) ?? listWorkflows(ctx.db).find(w => w.id.startsWith(args))
    if (!wf) {
      ctx.addMessage({ type: 'assistant', text: `Workflow not found: ${args}` })
      return
    }
    if (wf.phase !== 'paused') {
      ctx.addMessage({ type: 'assistant', text: `Cannot resume workflow in phase "${wf.phase}" (must be "paused")` })
      return
    }
    const nextPhase = wf.trigger.type === 'manual' ? 'executing' : 'active'
    updateWorkflowPhase(ctx.db, wf.id, nextPhase)
    ctx.addMessage({ type: 'assistant', text: `Resumed workflow "${wf.name}" — phase: ${nextPhase}` })
  },
})
