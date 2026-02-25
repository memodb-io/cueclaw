/** PreToolUse safety guard for local (non-Docker) execution.
 *  Returns a deny decision for dangerous bash commands. */
export function checkBashSafety(command: string): { allowed: boolean; reason?: string } {
  const dangerousPatterns: Array<[RegExp, string]> = [
    [/rm\s+-rf\s+\//, 'recursive delete from root'],
    [/\bsudo\b/, 'privilege escalation'],
    [/chmod\s+777/, 'world-writable permissions'],
    [/>\s*\/etc\//, 'write to system config'],
    [/\bmkfs\b/, 'format filesystem'],
    [/curl\s.*\|\s*(ba)?sh/, 'pipe-to-shell execution'],
    [/wget\s.*\|\s*(ba)?sh/, 'pipe-to-shell execution'],
    [/\bdd\b.*\bif=\/dev\//, 'raw disk operations'],
    [/>\s*\/dev\//, 'write to device files'],
    [/\bnc\b.*-[lp]/, 'netcat listener'],
    [/\bncat\b/, 'ncat listener'],
  ]

  for (const [pattern, reason] of dangerousPatterns) {
    if (pattern.test(command)) {
      return { allowed: false, reason: `Dangerous command blocked: ${reason}` }
    }
  }

  return { allowed: true }
}
