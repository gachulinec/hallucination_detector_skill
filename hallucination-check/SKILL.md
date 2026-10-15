---
name: hallucination-check
description: Fact-checks a text for hallucinations. Extracts every verifiable claim, checks each one against web sources (standard mode) or only against a given source document (faithfulness mode), and reports which claims are wrong, with evidence. Use when the user asks to fact-check or verify a text, to find hallucinations or factual errors in a report, article, summary or AI-generated answer, or to check a summary against its source. Also use it, with the quick profile, to check your own fact-heavy deliverable (research, report, summary) before handing it over when the user asked for verification or factual accuracy. Not for opinions, style or code.
license: MIT
compatibility: Requires Node.js 20+ and shell access; standard mode needs a web search tool; subagents recommended.
metadata:
  version: "1.0.0"
---

# Hallucination Check

A fixed fact-checking method. You do the reading and judging: extracting claims, searching, weighing evidence, deciding verdicts. The bundled script `hd` gives you the work one task at a time, checks every result in code and makes the rule-based decisions. The method is only as reliable as its steps: do not skip or shorten them.

`hd` means `node <directory of this skill>/scripts/hd.mjs`.

## Start

| Situation | Command |
|---|---|
| The user gives a text to fact-check | `hd init --text <file>` |
| The user gives a text and its source document | `hd init --text <file> --source <file>` |
| You check your own draft before handing it over | `hd init --text <file> --origin self` |

Save the text to a file first, exactly as it is (and the source document, in faithfulness mode).

Options:
- `--lang <language>`: the language the user writes in; the report's explanations use it (default English).
- `--no-subagents`: you cannot start subagents (see references/subagents.md).
- `--agent <your product name>` and `--model <model ids>`: recorded in the report.
- `--profile thorough|quick`: thorough by default; quick by default with `--origin self`.

## The loop

1. `hd init` prints the run directory and the first tasks. Each task is a file with exact instructions and the path of its result file.
2. Do every task:
   - **independence: required** — give it to a subagent with a fresh context that has not seen the checked text, the claims or earlier results. Dispatch prompt: "Read <task file> and follow it exactly. Write the result to the path it names. Do not run hd next." See references/subagents.md for your agent.
   - **independence: recommended** — use a subagent if you can, otherwise do it yourself.
   - **independence: not needed** — do it yourself.
   Tasks printed together do not depend on each other: run them in parallel when you can.
3. When every result file is written, run `hd next <run>`. It checks the results, asks for a retry of anything wrong and prints the next tasks.
4. Repeat 2–3 until `hd next` prints `DONE`, then present the result as references/reading-results.md says.

A retry task (`…-retry`) says what was wrong; do it like any other task. If `hd next` prints `FAILED`, tell the user what it says.

## Rules

- Write only the result files that tasks name. Never edit the files `hd` manages (state.json, claims.json, evidence.json and the others in the run directory).
- Never skip a task, and never write a result without doing the work. If a task cannot be done (for example, you have no web search), write the error result the task describes.
- Only you, the main agent, run `hd next`. Subagents only do their task; they may run `hd fetch` and `hd search`.
- Do not change the checked text while the check runs. In a self-check, fix your draft after the result.
- Do not tell the user that a claim is right or wrong before `hd` prints `DONE`.

## What happens

Standard mode: extract (claims) → questions, samples, sample-judgments (thorough profile: answers from fresh subagents that never see the claims, for a consistency check) → verify (web evidence) → judge (claims the rules cannot decide) → DONE. Details: references/standard-mode.md.

Faithfulness mode: extract → ground (each claim against the source document only) → DONE. Details: references/faithfulness-mode.md.

## Commands

| Command | Use |
|---|---|
| `hd init --text <file> [options]` | start a run; prints the first tasks |
| `hd next <run>` | check results; print the next tasks, `DONE` or `FAILED` |
| `hd fetch <run> <claim_id> "<url>"` | in verify tasks: download a page, print evidence passages with IDs |
| `hd search <run> <claim_id> "<query>"` | in verify tasks: search a local SearXNG, if one runs |
| `hd status <run>` | where the run is |
| `hd summary <run>` | the short result after `DONE` |

Runs are kept in `.hallucination-check/runs/` in the current directory (`--dir` changes it). An interrupted run continues with `hd next <run>`.

## Privacy

In standard mode, facts from the text go to your web search provider as queries, and pages are downloaded from this machine. Faithfulness mode does not use the web.
