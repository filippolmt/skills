import type { AgentInfo, On, RenderSurface } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const MIN = 60_000
const BAND = {
  plugin: 'work-eta',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 200,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

// The engine beneath the plugin: a mocked clock and store, and a subagent list the test edits.
// `session` says how the session started: `none` stands for a mod installed mid-session.
const engine = async (
  $: Engine,
  on: On,
  store: Record<string, unknown> = {},
  session: 'interactive' | 'headless' | 'none' = 'interactive',
) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 30, 12) })
  mock.store(on, store)
  const agents: AgentInfo[] = []
  on('agent.list', () => ({ value: agents }))
  // Where the session draws: none in a headless run until a client attaches.
  const surfaces: RenderSurface[] = session === 'headless' ? [] : ['terminal']
  on('session.surfaces', () => ({ value: surfaces }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  // Stands for another mod's band beneath this one.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>other band</Text>
  })
  if (session !== 'none') {
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: session === 'interactive' })
  }
  return { clock, agents, surfaces }
}

// A typed prompt and the main turn it starts.
const startTurn = async ($: Engine, turnId: string) => {
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'go', turnId })
}
const endTurn = ($: Engine, turnId: string, isAborted = false) =>
  $.turn.complete({ answer: '', durationMs: 0, turnId, isAborted, reason: isAborted ? 'aborted' : 'answer' })
const agent = (id: string, description: string): AgentInfo => ({ id, description, type: 'Explore', status: 'running' })
// Stored work durations, given in minutes.
const samples = (...m: number[]) => m.map(n => n * MIN)

// The band's own line, or undefined when it draws none; checked on every surface that has the band.
const band = async ($: Engine) => {
  const lines = new Set<string | undefined>()
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    lines.add((await ui.find({ type: 'Text', text: /^work running/ }))?.text)
    expect((await ui.find({ type: 'Text', text: /other band/ }))?.text).toBe('other band')
    await ui.unmount()
  }
  expect(lines.size).toBe(1)
  return [...lines][0]
}

test('fewer than 20 works in the bucket: elapsed time only', async ($, on) => {
  const { clock } = await engine($, on, { without: samples(...Array(19).fill(30)) })
  await startTurn($, 't1')
  await clock.advance(8 * MIN)

  expect(await band($)).toBe('work running 8m')
})

test('20 works: the 90th percentile of those at least as long as now, as minutes and clock time', async ($, on) => {
  // 1..20 minutes; at 8m the conditional samples are 8..20 (13 of them), p90 the 12th: 19m.
  const { clock } = await engine($, on, { without: samples(...Array.from({ length: 20 }, (_, i) => i + 1)) })
  await startTurn($, 't1')
  await clock.advance(8 * MIN)

  const line = await band($)
  expect(line).toMatch(/^work running 8m · usually done within 19m \(≈\d\d:\d\d\)$/)
  const at = new Date(clock.now() + 11 * MIN)
  expect(line).toContain(`${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`)
})

test('fewer than 5 works lasted this long: longer than usual', async ($, on) => {
  const { clock } = await engine($, on, { without: samples(...Array(16).fill(2), 30, 30, 30, 30) })
  await startTurn($, 't1')
  await clock.advance(10 * MIN)

  expect(await band($)).toBe('work running 10m · longer than usual (10m+)')
})

test('no band outside a work', async ($, on) => {
  await engine($, on)
  expect(await band($)).toBe(undefined)
})

test('a turn ending while a subagent runs does not end the work', async ($, on) => {
  const { clock, agents } = await engine($, on, { with: samples(...Array(19).fill(30)) })
  await startTurn($, 't1')
  await clock.advance(MIN)
  agents.push(agent('a1', 'scan the repo'))
  await clock.advance(5000)
  await clock.advance(MIN)
  agents.push(agent('a2', 'read the docs'))
  await endTurn($, 't1')
  await clock.advance(2 * MIN)

  expect(await band($)).toBe('work running 4m · 2 subagents · slowest: scan the repo')

  agents.splice(0, 2, { ...agents[0]!, status: 'completed' }, { ...agents[1]!, status: 'completed' })
  await clock.advance(5000)
  expect(await band($)).toBe(undefined)

  // The work was recorded under "with": the 20th sample turns the estimate on.
  await startTurn($, 't2')
  agents.push(agent('a3', 'write tests'))
  await clock.advance(5000)
  expect(await band($)).toMatch(/usually done within 30m/)
})

test('a turn started during a work continues it', async ($, on) => {
  const { clock, agents } = await engine($, on)
  await startTurn($, 't1')
  agents.push(agent('a1', 'scan the repo'))
  await clock.advance(5000)
  await endTurn($, 't1')
  await clock.advance(3 * MIN)
  await startTurn($, 't2')
  await clock.advance(2 * MIN)

  expect(await band($)).toMatch(/^work running 5m · 1 subagent ·/)
})

test('an interrupted work is not recorded', async ($, on) => {
  const { clock } = await engine($, on, { without: samples(...Array(19).fill(30)) })
  await startTurn($, 't1')
  await clock.advance(MIN)
  await endTurn($, 't1', true)
  expect(await band($)).toBe(undefined)

  await startTurn($, 't2')
  await clock.advance(MIN)
  expect(await band($)).toBe('work running 1m')
})

test('an interrupted work keeps its elapsed time while subagents run, and a later turn continues it unrecorded', async ($, on) => {
  const { clock, agents } = await engine($, on, { with: samples(...Array(19).fill(30)) })
  await startTurn($, 't1')
  agents.push(agent('a1', 'scan the repo'))
  await clock.advance(MIN)
  await endTurn($, 't1', true)
  await startTurn($, 't2')
  await clock.advance(MIN)
  expect(await band($)).toMatch(/^work running 2m · 1 subagent/)

  await endTurn($, 't2')
  agents.splice(0, 1, { ...agents[0]!, status: 'completed' })
  await clock.advance(5000)
  expect(await band($)).toBe(undefined)

  await startTurn($, 't3')
  agents.push(agent('a2', 'write tests'))
  await clock.advance(5000)
  expect(await band($)).toBe('work running 5s · 1 subagent · slowest: write tests')
})

test('a subagent that ends between two polls still records the work as "with"', async ($, on) => {
  const { clock } = await engine($, on, { with: samples(...Array(19).fill(30)) })
  await startTurn($, 't1')
  await $.turn.start({ text: 'look', turnId: 's1', agentId: 'a1' })
  await endTurn($, 't1')

  await startTurn($, 't2')
  await $.turn.start({ text: 'look', turnId: 's2', agentId: 'a2' })
  await clock.advance(MIN)
  expect(await band($)).toMatch(/usually done within 30m/)
})

test('a turn no typed prompt started, such as a task notification, starts no work', async ($, on) => {
  const { clock } = await engine($, on)
  await $.turn.start({ text: '', turnId: 't1' })
  await clock.advance(MIN)
  expect(await band($)).toBe(undefined)
  await endTurn($, 't1')

  await $.prompt.submit({ text: 'task done', wait: false, origin: { kind: 'task-notification' } })
  await $.turn.start({ text: 'task done', turnId: 't2' })
  await clock.advance(MIN)
  expect(await band($)).toBe(undefined)
})

test('a completed work is recorded, and the next one gets an estimate', async ($, on) => {
  const { clock } = await engine($, on, { without: samples(...Array(19).fill(30)) })
  await startTurn($, 't1')
  await clock.advance(MIN)
  await endTurn($, 't1')

  await startTurn($, 't2')
  await clock.advance(MIN)
  expect(await band($)).toMatch(/^work running 1m · usually done within 30m/)
})

test('the bucket switches to "with" when the first subagent starts', async ($, on) => {
  const { clock, agents } = await engine($, on, {
    without: samples(...Array(20).fill(5)),
    with: samples(...Array(20).fill(40)),
  })
  await startTurn($, 't1')
  await clock.advance(MIN)
  expect(await band($)).toMatch(/usually done within 5m/)

  agents.push(agent('a1', 'scan the repo'))
  await clock.advance(5000)
  expect(await band($)).toMatch(/usually done within 40m/)
})

test('a headless session shows and records no work', async ($, on) => {
  const { clock, surfaces } = await engine($, on, { without: samples(...Array(19).fill(30)) }, 'headless')
  await startTurn($, 't1')
  await clock.advance(MIN)
  expect(await band($)).toBe(undefined)
  await endTurn($, 't1')

  // A client attaching later (an SDK host) draws the band; the history still holds 19, so no estimate.
  surfaces.push('desktop')
  await startTurn($, 't2')
  await clock.advance(MIN)
  expect(await band($)).toBe('work running 1m')
})

test('a mod installed mid-session, with no session.start, still polls and records', async ($, on) => {
  const { clock, agents } = await engine($, on, { with: samples(...Array(19).fill(30)) }, 'none')
  await startTurn($, 't1')
  agents.push(agent('a1', 'scan the repo'))
  await endTurn($, 't1')
  await clock.advance(5000)
  expect(await band($)).toBe('work running 5s · 1 subagent · slowest: scan the repo')

  agents.splice(0, 1, { ...agents[0]!, status: 'completed' })
  await clock.advance(5000)
  expect(await band($)).toBe(undefined)

  await startTurn($, 't2')
  agents.push(agent('a2', 'write tests'))
  await clock.advance(5000)
  expect(await band($)).toMatch(/usually done within 30m/)
})
