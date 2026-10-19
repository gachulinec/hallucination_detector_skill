# hallucination-check

An [Agent Skill](https://agentskills.io/specification) that lets an AI agent fact-check a text the way the Hallucination Detector research pipeline does. It extracts every verifiable claim, checks each claim against web sources (standard mode) or only against a given source document (faithfulness mode), and reports which claims are wrong, with the evidence.

The agent does the reading, searching and judging. A bundled script, `hd`, gives it the work one task at a time, checks every result in code (quotes, numbers, evidence) and makes the rule-based decisions. Tasks that must not be influenced by the rest of the work, such as the final judgement, run in subagents with a fresh context.

## Requirements

- Node.js 22.12 or newer
- An agent that can read and write files and run shell commands
- Standard mode: a web search tool in the agent
- Recommended: subagents (see `hallucination-check/references/subagents.md`)

## Install

Copy the `hallucination-check` folder (or unzip the release asset) into your agent's skills directory:

| Agent | Directory |
|---|---|
| Claude Code | `~/.claude/skills/` (all projects) or `.claude/skills/` (one project) |
| Other agents | the agent's skills directory; the skill follows the open SKILL.md standard, but only Claude Code has been tested |

## Use

Ask your agent, for example:
- "Fact-check the text in report.md."
- "Check whether this summary is faithful to source.md."
- "Write an overview of … and check it with the hallucination-check skill before you give it to me."

Results are written to `.hallucination-check/runs/<time>/`: `summary.md` (the short result), `report.json` (every claim with its verdict and evidence) and `annotated_text.md`.

## How it works

| Mode | Steps |
|---|---|
| Standard (web) | extract claims → consistency check with three independent subagents (thorough profile) → web verification with evidence from `hd fetch` → rule-based verdicts → an independent judge for the rest |
| Faithfulness (source document) | extract claims → each claim checked against the source only, with verbatim quotes checked in code |

Profiles: `thorough` (default) and `quick` (default when an agent checks its own draft).

## Tested agents

| Agent | Version | Scenarios passed | Subagent isolation | Notes |
|---|---|---|---|---|
| Claude Code | 2.1.280, main agent Opus 5.5 | 4/4 (standard, faithfulness, self-check, long text) | yes | installed as a project skill and found without an explicit path |

Codex, Antigravity and other agents have not been tested. They should work if they can run Node.js and follow the SKILL.md standard; reports are welcome.

## Evaluation

Measured on the 40-document main set of the Hallucination Detector pipeline (20 standard, 20 faithfulness; 10 English and 10 Slovak each; 4 inserted errors and 2 true controls per document), one pass. Configuration: Claude Code 2.1.280, main agent Opus 5.5, subagents as `references/subagents.md` says (Opus for the judge, Sonnet otherwise), Claude Code's own web search with evidence fetched through `hd fetch`, thorough profile.

| Mode | Documents | Errors detected | Flags correct | Control false alarms |
|---|---|---|---|---|
| Standard (web search) | 20 | 80/80 (100 %) | 89/90 (99 %) | 0/40 |
| Faithfulness (source document only) | 20 | 80/80 (100 %) | 94/95 (99 %) | 0/40 |

Of 938 claims, one ended UNVERIFIABLE. The skill was measured at commit 18a9ba1; the later changes (how subagents report `executed_by`, and the fixes in 1.0.1, which leave the verdict rules unchanged) were not re-evaluated. The skill was improved using scenario runs on four documents of this set, so the results are likely more favourable than on new texts. Results hold only for the configuration they were measured with; other agents and models are not evaluated.

## Privacy

In standard mode, facts from the checked text are sent as search queries to the agent's web search provider, and pages are downloaded from your machine. Faithfulness mode does not use the web.

## Limits

- A clean result is not proof that a text is correct: the method flags a claim only on clear evidence.
- UNVERIFIABLE means too little evidence, not "false".
- Quality depends on the agent's model and web search.

## Development

The source of `hd` is in `src/` (TypeScript). The prompts, schemas and utilities in `src/prompts/`, `src/schemas/` and `src/utils/` come from the Hallucination Detector pipeline; `src/method/` adapts its rules; `src/hd/` is the CLI.

```bash
npm install
npm test           # tests
npm run typecheck
npm run build      # rebuilds hallucination-check/scripts/hd.mjs (commit it; a test checks it is current)
```

## License

MIT (see `LICENSE`). `hallucination-check/scripts/hd.mjs` bundles third-party packages; their licenses are in `hallucination-check/THIRD_PARTY_NOTICES.md`.
