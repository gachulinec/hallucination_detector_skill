# Running independent tasks

A task marked **independence: required** must run in a fresh context: it has not seen the checked text, the claims, earlier results or your conversation. It sees only its task file.

Dispatch prompt, the same for every agent:

> Read <task file> and follow it exactly. Write the result to the path it names. Do not run hd next.

Tasks printed together do not depend on each other: dispatch them in parallel when your agent allows it. Wait until every dispatched task has written its result, then run `hd next`.

## Per agent

Trust your actual tool list over this table.

| Agent | Dispatch | Fresh context | Model per task |
|---|---|---|---|
| Claude Code | `Agent` tool, general-purpose subagent; several calls in one message run in parallel | yes | `model: "opus"` for tasks marked strongest, `"sonnet"` otherwise |
| Codex | `spawn_agent` with `fork_turns: "none"` (needs `[features] multi_agent = true` in `~/.codex/config.toml`) | only with `fork_turns: "none"` | the session default, unless the model is on your spawn allowlist |
| Antigravity CLI | `invoke_subagent` with TypeName `self` | not confirmed: if the subagent can see your conversation, start the run with `--no-subagents` | the session default |
| Gemini CLI | `invoke_agent` with `agent_name: "generalist"` | yes | the session default |
| Other agents | your subagent tool, if you have one | check before you rely on it | — |

## Without subagents

Start the run with `hd init --no-subagents` and do every task yourself, in order.
- The consistency step (three independent samples) is skipped: answers you write after reading the claims are not independent.
- Tasks marked required (judge, ground, and verify in a self-check) are done by you; the report warns that their independence was not ensured.

## Recording who did a task

Every result has `"executed_by"`: `"subagent"` when another agent gave you the task file (also when you do the task yourself, as task files ask), `"main"` only for the agent that runs `hd next`. Write it truthfully: the report computes from it whether the check was independent, and samples marked `"main"` switch the consistency check off.
