import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Work } from '../types'

// `plugin` and `key` stay literal in each ref: `claude plugin validate` reads them from the source.
const WORK = { plugin: 'work-eta', key: 'work' } as const
const workAtom = atom(WORK, null)
const LINE = { plugin: 'work-eta', key: 'line' } as const
const PROMPT_PENDING = { plugin: 'work-eta', key: 'isPromptPending' } as const

const TICK_MS = 5000
const ACTIVE_STATUSES = new Set(['pending', 'running', 'waiting'])
const HISTORY_SIZE = 200
const MIN_WORKS = 20
const MIN_CONDITIONAL = 5

type Bucket = 'with' | 'without'
const bucketOf = (hadSubagents: boolean): Bucket => (hadSubagents ? 'with' : 'without')

// Seconds under a minute, so the first minute does not read as a stuck `0m`.
const duration = (ms: number) => (ms < 60000 ? `${Math.floor(ms / 1000)}s` : `${Math.floor(ms / 60000)}m`)

const clockTime = (ms: number) => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const durations = async ($: EngineInterface, bucket: Bucket) => {
  const stored = await $.store.get(bucket)
  return Array.isArray(stored) ? stored.filter((d): d is number => Number.isFinite(d)) : []
}

// The tail after the elapsed time: the 90th percentile of past works that lasted at least as long.
const estimate = (history: number[], elapsed: number, now: number) => {
  if (history.length < MIN_WORKS) return null
  const longer = history.filter(d => d >= elapsed).sort((a, b) => a - b)
  if (longer.length < MIN_CONDITIONAL) return `longer than usual (${duration(elapsed)}+)`
  const p90 = longer[Math.ceil(longer.length * 0.9) - 1]!
  return `usually done within ${Math.ceil(p90 / 60000)}m (≈${clockTime(now + p90 - elapsed)})`
}

// Closes the work and records its duration unless it was interrupted.
const close = async ($: EngineInterface, work: Work, version: number, bucket: Bucket, elapsed: number) => {
  // ifVersion: a tick and a turn end racing to close the same work record it once.
  const { isSet } = await $.state.set(WORK, null, { ifVersion: version })
  if (!isSet) return
  await $.state.set(LINE, null)
  if (work.isDiscarded) return
  // shortcut: get+set is not atomic, so concurrent sessions may lose a sample; a store lock if that matters.
  await $.store.set(bucket, [...(await durations($, bucket)), elapsed].slice(-HISTORY_SIZE))
}

// Polls the subagents, then closes the work when nothing runs or writes the band's line.
const refresh = async ($: EngineInterface) => {
  const { value: work, version } = await $.state.get(WORK)
  if (!work) return

  const now = await $.clock.now()
  const active = (await $.agent.list()).filter(a => ACTIVE_STATUSES.has(a.status))
  const firstSeen = Object.fromEntries(active.map(a => [a.id, work.firstSeen[a.id] ?? now]))
  const hadSubagents = work.hadSubagents || active.length > 0
  const elapsed = now - work.startedAt

  if (!work.isTurnRunning && active.length === 0) return close($, work, version, bucketOf(hadSubagents), elapsed)

  // Writes only what changed: the line moves once a minute, and each write redraws the band.
  const isSameAgents = active.length === Object.keys(work.firstSeen).length && active.every(a => a.id in work.firstSeen)
  if (!isSameAgents || hadSubagents !== work.hadSubagents) {
    const { isSet } = await $.state.set(WORK, { ...work, firstSeen, hadSubagents }, { ifVersion: version })
    if (!isSet) return
  }

  const parts = [`work running ${duration(elapsed)}`]
  if (active.length > 0) {
    const slowest = active.reduce((a, b) => (firstSeen[b.id]! < firstSeen[a.id]! ? b : a))
    parts.push(`${active.length} subagent${active.length === 1 ? '' : 's'}`, `slowest: ${slowest.description}`)
  }
  const tail = estimate(await durations($, bucketOf(hadSubagents)), elapsed, now)
  if (tail) parts.push(tail)
  const line = parts.join(' · ')
  if ((await $.state.get(LINE)).value !== line) await $.state.set(LINE, line)
}

// update() retries on a version miss, so a tick writing in between cannot drop the change.
const patch = ($: EngineInterface, change: (work: Work) => Partial<Work>) =>
  update($, workAtom, work => (work ? { ...work, ...change(work) } : null))

let isPolling = false

// Also started at a turn: a mod installed mid-session may never hear session.start.
const startPolling = ($: EngineInterface) => {
  if (isPolling) return
  isPolling = true
  $.clock.every(TICK_MS, () => refresh($))
}

// A headless run (`claude -p`, the SDK before a client attaches) draws nowhere: no work to wait on, none recorded.
const isDrawn = async ($: EngineInterface) => (await $.session.surfaces()).length > 0

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (await isDrawn($)) startPolling($)
    return next(e)
  })

  // Only a prompt that is not a task notification may start a work, at its turn's start.
  // Set before next(e): it resolves once that turn has started.
  on('prompt.submit', async ($, e, next) => {
    await $.state.set(PROMPT_PENDING, e.origin.kind !== 'task-notification')
    return next(e)
  })

  // The work starts at turn.start, not prompt.submit: a built-in command (/clear) submits a prompt and runs no turn.
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      // Seen here too: a subagent that starts and ends between two polls still makes the work "with".
      await patch($, () => ({ hadSubagents: true }))
    } else {
      const now = await $.clock.now()
      const { value: isPromptPending = false } = await $.state.get(PROMPT_PENDING)
      await $.state.set(PROMPT_PENDING, false)
      const canStart = isPromptPending && (await isDrawn($))
      // The turn that starts a work starts the poll that ends it.
      if (canStart) startPolling($)
      // A turn started during a work continues it.
      await update($, workAtom, work =>
        work
          ? { ...work, isTurnRunning: true }
          : canStart
            ? { startedAt: now, isTurnRunning: true, isDiscarded: false, hadSubagents: false, firstSeen: {} }
            : null,
      )
      await refresh($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await patch($, work => ({ isTurnRunning: false, isDiscarded: work.isDiscarded || e.isAborted }))
      await refresh($)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { value: text } = await $.state.get(LINE)
    if (e.props.hasSurvey || !text) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text>{text}</Text>
        {await next(e)}
      </Box>
    )
  })
}
