# dsh-goal-restart implementation contract

## Invariants (non-negotiable)

1. **Only persisted rehydration arms.** A goal is re-armed only when
   `agent/session-start` carries `source: 'resume'`. `startup` (fresh
   session, fork, subagent) never arms.
2. **Durable phase wins.** Only `phase: 'active'` goals are re-armed;
   paused/blocked/complete goals are never touched.
3. **Budget respected.** `roundsStarted >= maxGoalRounds` is never re-armed
   (no implicit cap increases).
4. **Idempotent.** An already-armed goal is skipped, not resumed again.
5. **No fabricated state.** The plugin calls only the public goal service
   verbs (`get`, `resume`); it never writes `goal/change` by hand.
6. **No model context.** The plugin adds no prompt content and no tools.
7. **Tests never need the network or a live process.** In-memory fakes only.

## Layout

- `package.json` — `dsh-goal-restart`, MIT-licensed, `dsh.bundle.patch`.
- `cordis.patch.yml` — inserts the `goal-restart` plugin row.
- `src/index.mjs` — cordis entry (`name` 'dsh-goal-restart', `inject`
  ['agents', 'goals'], `apply(ctx)`), exported `maybeRearm(agent, goals, log)`
  returning a stable outcome string.
- `test/index.test.mjs` — pure in-memory policy tests (node:assert).
- `scripts/smoke.mjs` — end-to-end wiring check with a fake Cordis context.
- `README.md` / `README.zh.md` — public-facing usage and policy (EN/ZH).
- `LICENSE` — MIT.

## Outcome codes

`maybeRearm` returns: `re-armed`, `skip-no-goal`, `skip-<phase>`,
`skip-already-armed`, `skip-rounds-exhausted`, `skip-subagent`, `skip-fork`,
or `error` (read/resume threw).
