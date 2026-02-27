import type { SlashCommand } from './types.js'

const commands: SlashCommand[] = []

export function registerCommand(cmd: SlashCommand): void {
  commands.push(cmd)
}

export function getCommands(): SlashCommand[] {
  return commands
}

export function findCommand(name: string): SlashCommand | undefined {
  const lower = name.toLowerCase()
  return commands.find(c => c.name === lower || c.aliases.includes(lower))
}

/** Parse a slash command string. Returns null if not a slash command. */
export function parseSlashCommand(input: string): { name: string; args: string } | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null
  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx === -1) {
    return { name: trimmed.slice(1), args: '' }
  }
  return { name: trimmed.slice(1, spaceIdx), args: trimmed.slice(spaceIdx + 1).trim() }
}
