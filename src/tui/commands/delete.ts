import { registerCommand } from './registry.js'
import { getWorkflow, listWorkflows, deleteWorkflow } from '../../db.js'

registerCommand({
  name: 'delete',
  aliases: ['rm'],
  description: 'Delete a workflow',
  usage: '/delete <id>',
  execute(args, ctx) {
    if (!args) {
      ctx.addMessage({ type: 'assistant', text: 'Usage: /delete <workflow-id>' })
      return
    }
    const wf = getWorkflow(ctx.db, args) ?? listWorkflows(ctx.db).find(w => w.id.startsWith(args))
    if (!wf) {
      ctx.addMessage({ type: 'assistant', text: `Workflow not found: ${args}` })
      return
    }
    if (wf.phase === 'executing') {
      ctx.addMessage({ type: 'assistant', text: 'Cannot delete workflow while it is executing.' })
      return
    }
    deleteWorkflow(ctx.db, wf.id)
    ctx.addMessage({ type: 'assistant', text: `Deleted workflow "${wf.name}" (${wf.id})` })
  },
})
