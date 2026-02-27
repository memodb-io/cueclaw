import { registerCommand } from './registry.js'
import { getWorkflow, listWorkflows, updateWorkflowPhase } from '../../db.js'

registerCommand({
  name: 'pause',
  aliases: [],
  description: 'Pause a workflow',
  usage: '/pause <id>',
  execute(args, ctx) {
    if (!args) {
      ctx.addMessage({ type: 'assistant', text: 'Usage: /pause <workflow-id>' })
      return
    }
    const wf = getWorkflow(ctx.db, args) ?? listWorkflows(ctx.db).find(w => w.id.startsWith(args))
    if (!wf) {
      ctx.addMessage({ type: 'assistant', text: `Workflow not found: ${args}` })
      return
    }
    if (wf.phase !== 'active') {
      ctx.addMessage({ type: 'assistant', text: `Cannot pause workflow in phase "${wf.phase}" (must be "active")` })
      return
    }
    updateWorkflowPhase(ctx.db, wf.id, 'paused')
    ctx.addMessage({ type: 'assistant', text: `Paused workflow "${wf.name}" (${wf.id})` })
  },
})
