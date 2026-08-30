/**
 * dsh-goal-restart - automatic goal restart across dsh service restarts.
 *
 * Why this exists
 * ---------------
 * In the DeepSeek Harness, a persisted same-session goal's durable state
 * (objective, phase, revision, roundsStarted) lives in the session log and
 * survives restarts - but its ability to continue automatically (the
 * process-local 'armed' activation) deliberately does not. Every
 * 'agent/session-start' edge disarms activation, and a fresh process starts
 * with everything disarmed. So when the dsh service goes down and comes back
 * (crash, launchd respawn, the classic 'the agent was fiddling with its own
 * plugins and restarted the service' case), a goal that was actively being
 * worked on is replayed with phase 'active' but never continues again until
 * a human issues an explicit resume.
 *
 * This plugin re-arms such goals automatically at the exact moment their
 * session is rehydrated from persistence into a live agent - i.e. when the
 * dsh service (re)started and the conversation is loaded again. From there
 * the stock 'goal-round-driver' (already mounted by dsh-base) reserves and
 * queues the next round on its own, so goal rounds resume without any human
 * intervention.
 *
 * Why it is safe
 * --------------
 * - 'agent/session-start' carries source: 'resume' | 'startup' | 'clear' |
 *   'compact'. Only 'resume' (a session loaded from persistence) arms.
 *   Fresh sessions, forks, and subagents publish as 'startup' and are
 *   skipped, so a fork never silently hijacks the parent's goal.
 * - Only a durable 'active' goal with remaining round budget
 *   (roundsStarted < maxGoalRounds) is re-armed. Paused, blocked, completed,
 *   or round-exhausted goals are left exactly as they are.
 * - ctx.goals.resume(agent, ref) is the domain's own public re-arm verb
 *   ('rearm an active goal after a session-start edge'); it refuses an
 *   already-armed goal, so the policy stays idempotent.
 *
 * Mounting
 * --------
 * As a dsh bundle (dsh-goal-restart listed in dsh.profile.bundles),
 * its cordis.patch.yml inserts the goal-restart row. Disable it per-profile:
 *   - id: goal-restart
 *     disabled: true
 */

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'dsh-goal-restart'

/** Hard dependencies: the agent registry and the same-session goal service. */
export const inject = ['agents', 'goals']

/**
 * Attempt one conservative re-arm for an exact live agent.
 * @param {object} agent - the exact live Agent (as returned by ctx.agents).
 * @param {object} goals - the goal service (ctx.goals); needs get() and resume().
 * @param {Function} [log] - optional (message, level) sink; defaults to a no-op.
 * @returns {string} a stable machine-readable outcome string.
 */
export function maybeRearm(agent, goals, log = () => {}) {
  const meta = agent?.session?.meta ?? {}
  // Subagent children and forked sessions are in-process lineage, not a
  // service restart; never steal their (inherited) goal.
  if (meta.origin === 'subagent') return 'skip-subagent'
  if (meta.parentSession !== undefined) return 'skip-fork'
  let goal
  try {
    goal = goals.get(agent)
  } catch (error) {
    log(`could not read goal for agent ${agent?.id}: ${error?.message ?? error}`, 'warn')
    return 'error'
  }
  if (goal === undefined) return 'skip-no-goal'
  if (goal.phase !== 'active') return `skip-${goal.phase}`
  if (goal.activation === 'armed') return 'skip-already-armed'
  if (goal.roundsStarted >= goal.maxGoalRounds) return 'skip-rounds-exhausted'
  try {
    const view = goals.resume(agent, { id: goal.id, revision: goal.revision })
    log(
      `re-armed goal ${goal.id} for agent ${agent.id} - next round ${view.roundsStarted + 1}/${view.maxGoalRounds}`
    )
    return 're-armed'
  } catch (error) {
    log(`could not re-arm goal for agent ${agent.id}: ${error?.message ?? error}`, 'warn')
    return 'error'
  }
}

/**
 * Install the automatic restart policy into a Cordis context.
 * 1. On 'agent/session-start' with source === 'resume' (the session was just
 *    loaded from persistence - i.e. the service restarted), re-arm the active
 *    goal. The goal service's own session-start listener (constructed before
 *    this plugin mounts, since we inject 'goals') has already disarmed
 *    activation, so resume() arms cleanly and emits goal/changed, which the
 *    stock round driver observes.
 * 2. Defensive sweep over agents already live at mount time (plugin
 *    hot-reload while sessions are open never re-fires session-start).
 */
export function apply(ctx) {
  const log = (message, level = 'info') => {
    ctx.logger?.[level]?.(`goal-restart: ${message}`)
  }

  ctx.on('agent/session-start', ({ agent, source }) => {
    if (source !== 'resume') return
    maybeRearm(agent, ctx.goals, log)
  })

  for (const agent of ctx.agents.list()) {
    maybeRearm(agent, ctx.goals, log)
  }
}
