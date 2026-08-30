English | [中文](README.zh.md)
# dsh-goal-restart

Re-arm persisted same-session goals automatically when the dsh service
(re)starts, so the [goal-round driver](https://github.com/deepseek-ai/deepseek-harness)
resumes rounds without human intervention.

> **Why?** When an agent is doing long-running work — like developing its own
> plugins — and the service it lives in gets restarted (crash, launchd
> respawn, a deliberate bounce), the in-flight goal used to stay stuck until
> somebody ran `/goal resume`. This plugin removes that step.

## The problem

A dsh goal's **durable state** (objective, phase, revision, `roundsStarted`)
lives in the session log and survives restarts. Its **activation** ("armed")
is deliberately process-local: it is never persisted, and every
`agent/session-start` edge disarms it. So after the dsh service restarts, an
in-flight goal is replayed as `active` but stays stopped until someone issues
an explicit resume.

## What this plugin does

On `agent/session-start` where `payload.source === 'resume'` (the session was
just loaded from persistence), it calls `ctx.goals.resume(agent, ref)` for a
durable-`active` goal that still has round budget. The stock
`goal-round-driver` (mounted by `dsh-base`) then reserves and queues the next
round exactly as it would after a normal human resume — but nobody had to
click anything.

## Policy (conservative, in one table)

| Situation                                        | Action                      |
| ------------------------------------------------- | --------------------------- |
| Session rehydrated after a service restart, goal `active`, budget left | re-arm (`ctx.goals.resume`) |
| Session started fresh (`source: 'startup'`)          | skip (no goal)              |
| Forked session (inherited goal)                    | skip (in-process lineage)   |
| Subagent session (`origin: subagent`)               | skip (in-process lineage)   |
| Goal `paused` / `blocked` / `complete`              | skip (durable phase wins)   |
| Goal `active` but already `armed`                   | skip (idempotent)           |
| Goal at `roundsStarted >= maxGoalRounds`            | skip (no budget — raise the cap, then resume) |

## Install

```sh
# once published on npm:
npm i dsh-goal-restart

# or from a checkout:
dsh plugin --profile <profile> add /path/to/dsh-goal-restart
```

Then add the bundle to the profile manifest
(`$DSH_HOME/profiles/<profile>/package.json`):

```json
{
  "dependencies": { "dsh-goal-restart": "file:/path/to/dsh-goal-restart" },
  "dsh": { "profile": { "bundles": [ "...", "dsh-goal-restart" ] } }
}
```

Install and verify, then restart the service so the new bundle is loaded:

```sh
dsh plugin --profile web install
dsh web --dump-config | grep -A2 goal-restart   # verify without booting
launchctl kickstart -k gui/$(id -u)/com.dsh.web # or however you restart dsh
```

## Disable

In the profile's `cordis.patch.yml`:

```yaml
- id: goal-restart
  disabled: true
```

## Notes

- Re-arming writes one durable `resume` mutation (revision +1) into the
  session log — the domain's documented reactivation edge, and the same
  write a human `/goal resume` performs.
- The round driver already handles durability and cancellation safety; this
  plugin only decides *that* continuation is wanted, not *how* it runs.
- Sessions resume when a live agent loads them. In the web GUI that happens
  when the conversation is reopened after restart; re-arming occurs at that
  moment, before the driver's first idle checkpoint.
- The policy is verified by 13 in-memory unit tests (`npm test`) and a smoke
  script (`npm run smoke`) that need no network and no live process.

## License

[MIT](LICENSE)
