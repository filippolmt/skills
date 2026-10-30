export type Work = {
  startedAt: number
  isTurnRunning: boolean
  isDiscarded: boolean
  hadSubagents: boolean
  // When each active subagent was first seen: AgentInfo carries no start time.
  firstSeen: Record<string, number>
}

declare module 'claude-code' {
  interface PluginState {
    'work-eta': { work: Work | null; line: string | null; isPromptPending: boolean }
  }
}
