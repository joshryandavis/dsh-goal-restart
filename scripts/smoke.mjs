/**
 * Smoke: wire the plugin against a fake Cordis context and replay the exact
 * service-restart lifecycle this plugin exists for. Output is a small
 * timeline; exit code 0 means the policy held.
 * Run with: node scripts/smoke.mjs
 */
import { apply, maybeRearm } from '../src/index.mjs'

function fakeGoals(initial) {
  let goal = initial
  return {
    get: () => (goal === undefined ? undefined : goal),
    resume: (agent, ref) => {
      if (!goal || goal.id !== ref.id || goal.revision !== ref.revision) throw new Error('stale ref')
      goal = { ...goal, revision: goal.revision + 1, activation: 'armed' }
      return goal
    },
  }
}

function agent(id, meta = {}) { return { id, session: { meta } } }

// ---------- simulated timeline: service was mid-goal when it died ----------
const goal = {
  id: 'goal-dsh-goal-restart-demo',
  revision: 7,
  objective: 'Land the goal-restart plugin so goals survive dsh restarts',
  phase: 'active',
  maxGoalRounds: 12,
  roundsStarted: 3,
  activation: 'disarmed', // <- the ONLY thing the restart erased
}
const goals = fakeGoals(goal)
const session = agent('session-after-restart') // source: 'resume'

const listeners = {}
const logs = []
const ctx = {
  agents: { list: () => [] },
  goals,
  logger: { info: (m) => logs.push(m), warn: (m) => logs.push('WARN ' + m) },
  on: (event, fn) => { (listeners[event] ??= []).push(fn) },
  emit: (event, payload) => { for (const fn of listeners[event] ?? []) fn(payload) },
}

console.log('dsh-goal-restart smoke — service restart re-arm lifecycle')
console.log('  process 1: goal was armed and mid-round (roundsStarted 3/12)')
console.log('  process 1: ... service dies (crash / plugin work / launchd respawn) ...')
console.log('  process 2: session rehydrated from persistence — activation came back disarmed')
console.log('')

apply(ctx)
ctx.emit('agent/created', { agent: session, source: 'resume' })

const rearmed = goals.get(session)
console.log(`  after resume  : ${rearmed.phase} / ${rearmed.activation} (revision ${rearmed.revision})`,
  `— next round ${rearmed.roundsStarted + 1}/${rearmed.maxGoalRounds} pending (goal-round-driver takes it from here)`,
)
console.log(`  goal objective: ${JSON.stringify(rearmed.objective)}`)
console.log('')
for (const line of logs) console.log('  log: ' + line)

const ok = rearmed.phase === 'active' && rearmed.activation === 'armed' && rearmed.revision === 8
console.log('')
console.log(ok ? 'SMOKE OK — goal re-armed; driver will resume next round automatically' : 'SMOKE FAILED')
process.exit(ok ? 0 : 1)
