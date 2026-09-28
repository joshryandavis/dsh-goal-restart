# dsh-goal-restart

当 dsh 服务（重新）启动时，自动重新武装（re-arm）持久化的同会话目标，
让 [goal-round driver](https://github.com/deepseek-ai/deepseek-harness)
无需人工干预即可自动续跑目标轮次。

> **为什么需要它？** 当智能体正在做长期任务——比如开发它自己的插件——而它
> 所在的服务被重启（崩溃、launchd 自动拉起、主动重启）时，此前进行中的目标
> 会一直停在原处，直到有人执行 `/goal resume`。这个插件省掉了这一步。

## 问题背景

dsh 目标的**持久化状态**（objective、phase、revision、`roundsStarted`）保存在
会话日志中，可以跨重启存活。但它的**激活状态**（"armed"）刻意做成进程本地：
它从不持久化，而且每次 `agent/created` 边界都会解除武装（disarm）。
因此，当 dsh 服务重启后，进行中的目标会被回放为 `active`，但会一直停住，
直到有人显式恢复（resume）。

## 这个插件做什么

在 `agent/created` 且 `payload.source === 'resume'`（会话刚从持久化
存储重新加载）时，只要目标处于持久化的 `active` 状态且还有轮次预算，就调用
`ctx.goals.resume(agent, ref)`。随后内置的 `goal-round-driver`（由
`dsh-base` 挂载）会像普通的人类恢复那样预留并投递下一轮——只是这次不需要
任何人去点按钮。

## 策略（保守，一目了然）

| 场景                                            | 动作                          |
| ------------------------------------------------ | ----------------------------- |
| 服务重启后会话重新加载，目标 `active`，预算充足       | 重新武装（`ctx.goals.resume`）   |
| 新会话启动（`source: 'startup'`）                  | 跳过（无目标）                 |
| Fork 出来的会话（继承父目标）                      | 跳过（进程内派生）             |
| 子代理会话（`origin: subagent`）                   | 跳过（进程内派生）             |
| 目标为 `paused` / `blocked` / `complete`          | 跳过（以持久化阶段为准）       |
| 目标为 `active` 但已经 `armed`                     | 跳过（幂等）                   |
| 目标已达 `roundsStarted >= maxGoalRounds`         | 跳过（无预算——先调大上限再恢复）|

## 安装

```sh
dsh plugin --profile <profile> add dsh-goal-restart
```

然后重启 dsh 服务以加载新的 bundle。

## 禁用

在 profile 的 `cordis.patch.yml` 中加入：

```yaml
- id: goal-restart
  disabled: true
```

## 说明

- 重新武装会向会话日志写入一条持久的 `resume` 变更（revision +1）——这是领域
  文档中规定的重新激活边界，与人工执行 `/goal resume` 写入的内容一致。
- 轮次驱动的持久化与取消安全已由 round driver 处理；本插件只决定*要不要*继续，
  不决定*如何*运行。
- 会话在某个活体智能体加载它时才会恢复。在 Web GUI 中，这发生在重启后重新打开
  会话时；重新武装就在那一刻发生，早于 driver 的第一个空闲检查点。
- 该策略由 13 个纯内存单元测试（`npm test`）和一个 smoke 脚本（`npm run smoke`）
  验证，都不需要网络和真实进程。

## 许可证

[MIT](LICENSE)
