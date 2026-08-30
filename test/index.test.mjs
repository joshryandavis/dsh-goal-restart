/**
 * In-memory policy tests for dsh-goal-restart. No network, no live process.
 * Run with: node test/index.test.mjs
 */
import assert from 'node:assert/strict'
import { maybeRearm, apply } from '../src/index.mjs'

/** Minimal goal-service fake recording calls. */
function fakeGoals(initial = {}) {
  const state = { ...initial }
  const calls = { get: 0, resume: [] }
  return {
    calls,
    get() {
      calls.get += 1
      if (state.getError) throw state.getError
      return state.goal === undefined ? undefined : state.goal
    },
    resume(agent, ref) {
      calls.resume.push(ref)
      if (state.resumeError) throw state.resumeError
      const goal = state.goal
      if (goal === undefined || goal.id !== ref.id || goal.revision !== ref.revision) {
        throw new Error('stale or missing goal ref')
      }
      const next = { ...goal, revision: goal.revision + 1, activation: 'armed' }
      state.goal = next
      return next
    },
  }
}

function agent(id, meta = {}) {
  return { id, session: { meta } }
}

function activeGoal(over = {}) {
  return { id: 'goal-1', revision: 3, phase: 'active', maxGoalRounds: 10, roundsStarted: 2, activation: 'disarmed', ...over }
}

let passed = 0
let failed = 0
function case_(name, fn) {
  try { fn(); passed += 1; console.log('  ok ' + name) }
  catch (error) { failed += 1; console.error('  FAIL ' + name + '\n    ' + (error?.stack ?? error)) }
}

console.log('maybeRearm unit policy')
case_('re-arms an active disarmed goal within budget', () => {
  const goals = fakeGoals({ goal: activeGoal() })
  const logs = []
  const outcome = maybeRearm(agent('sess-1'), goals, (m) => logs.push(m))
  assert.equal(outcome, 're-armed')
  assert.deepEqual(goals.calls.resume, [{ id: 'goal-1', revision: 3 }])
  assert.equal(goals._state !== undefined ? void 0 : void 0, undefined)
  assert.ok(logs.some((m) => m.includes('re-armed goal goal-1')))
})

case_('skips an already-armed active goal without calling resume', () => {
  const goals = fakeGoals({ goal: activeGoal({ activation: 'armed' }) })
  assert.equal(maybeRearm(agent('sess-1'), goals), 'skip-already-armed')
  assert.deepEqual(goals.calls.resume, [])
})

case_('skips paused, blocked and complete goals', () => {
  for (const phase of ['paused', 'blocked', 'complete']) {
    const goals = fakeGoals({ goal: activeGoal({ phase }) })
    assert.equal(maybeRearm(agent('sess-1'), goals), 'skip-' + phase)
    assert.deepEqual(goals.calls.resume, [])
  }
})

case_('skips a goal whose round budget is exhausted', () => {
  const goals = fakeGoals({ goal: activeGoal({ roundsStarted: 10, maxGoalRounds: 10 }) })
  assert.equal(maybeRearm(agent('sess-1'), goals), 'skip-rounds-exhausted')
  assert.deepEqual(goals.calls.resume, [])
})

case_('skips when there is no current goal', () => {
  const goals = fakeGoals({ goal: undefined })
  assert.equal(maybeRearm(agent('sess-1'), goals), 'skip-no-goal')
  assert.deepEqual(goals.calls.resume, [])
})

case_('skips subagent sessions before touching the goal service', () => {
  const goals = fakeGoals({ goal: activeGoal() })
  assert.equal(maybeRearm(agent('sess-sub', { origin: 'subagent' }), goals), 'skip-subagent')
  assert.equal(goals.calls.get, 0)
  assert.deepEqual(goals.calls.resume, [])
})

case_('skips forked sessions before touching the goal service', () => {
  const goals = fakeGoals({ goal: activeGoal() })
  assert.equal(maybeRearm(agent('sess-fork', { parentSession: 'sess-parent' }), goals), 'skip-fork')
  assert.equal(goals.calls.get, 0)
  assert.deepEqual(goals.calls.resume, [])
})

case_('reports read errors without throwing', () => {
  const goals = fakeGoals({ getError: new Error('not live') })
  const logs = []
  assert.equal(maybeRearm(agent('sess-1'), goals, (m, l) => logs.push([m, l])), 'error')
  assert.equal(logs.length, 1)
})

case_('reports resume errors without throwing', () => {
  const goals = fakeGoals({ goal: activeGoal(), resumeError: new Error('GOAL_INVALID_TRANSITION') })
  const logs = []
  assert.equal(maybeRearm(agent('sess-1'), goals, (m, l) => logs.push([m, l])), 'error')
  assert.deepEqual(goals.calls.resume, [{ id: 'goal-1', revision: 3 }])
})

console.log('apply(ctx) wiring')
function fakeCtx(agents, goals) {
  const listeners = {}
  const logs = []
  return {
    agents: { list: () => agents },
    goals,
    logger: { info: (m) => logs.push(['info', m]), warn: (m) => logs.push(['warn', m]) },
    on: (event, fn) => { (listeners[event] ??= []).push(fn) },
    emit: (event, payload) => { for (const fn of listeners[event] ?? []) fn(payload) },
    listeners,
    logs,
  }
}

case_('re-arms on session-start with source resume', () => {
  const goals = fakeGoals({ goal: activeGoal() })
  const a = agent('sess-1')
  const ctx = fakeCtx([a], goals)
  apply(ctx)
  ctx.emit('agent/session-start', { agent: a, source: 'resume' })
  assert.deepEqual(goals.calls.resume, [{ id: 'goal-1', revision: 3 }])
  assert.ok(ctx.logs.some(([lvl, m]) => lvl === 'info' && m.includes('re-armed')))
})

case_('does not re-arm on session-start with source startup', () => {
  // At real boot no agent exists yet at apply() time, so only the
  // session-start edge can arm — and a startup edge must not.
  const goals = fakeGoals({ goal: activeGoal() })
  const a = agent('sess-fresh')
  const ctx = fakeCtx([], goals)
  apply(ctx)
  ctx.emit('agent/session-start', { agent: a, source: 'startup' })
  assert.deepEqual(goals.calls.resume, [])
  assert.equal(goals.calls.get, 0)
})

case_('sweeps agents already live when the plugin mounts', () => {
  const goals = fakeGoals({ goal: activeGoal() })
  const a = agent('sess-live-before-load')
  const ctx = fakeCtx([a], goals)
  apply(ctx)
  assert.deepEqual(goals.calls.resume, [{ id: 'goal-1', revision: 3 }])
})

case_('sweep skips a forked agent already live when the plugin mounts', () => {
  const goals = fakeGoals({ goal: activeGoal() })
  const a = agent('sess-fork', { parentSession: 'sess-parent' })
  const ctx = fakeCtx([a], goals)
  apply(ctx)
  assert.deepEqual(goals.calls.resume, [])
})

console.log('')
console.log(`done: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
