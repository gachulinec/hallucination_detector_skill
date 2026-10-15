# Standard mode (web)

For a text without a source document: each claim is checked against web sources.

## Steps

| Step | Tasks | Who | What hd checks |
|---|---|---|---|
| extract | `extract-NN`, one per part of the text | subagent recommended | every claim's sentence is in the text; every number of a sentence has a claim (one retry) |
| questions | `questions` (thorough profile) | you | one question per claim |
| samples | `sample-1` … `sample-3` (thorough) | **three separate fresh subagents** | an answer to every question |
| sample-judgments | `sample-judgments` (thorough) | you | three labels per claim; hd computes the consistency score |
| verify | `verify-NN` | subagent recommended (required with `--origin self`) | evidence IDs exist; SUPPORTED and CONTRADICTED are backed by evidence; at most 5 items per claim |
| judge | `judge-NN`, only for claims the rules cannot decide | **fresh subagent, strongest model** | a valid verdict; hd applies the guardrails |

## Why the samples need fresh subagents

The consistency check asks whether a model that has never seen the claim states the same fact. A sample task shows only the questions. A subagent that has seen the text, the claims or your conversation gives answers that are not independent, and the check means nothing. Without subagents, start with `hd init --no-subagents`: the consistency step is skipped and the report says so.

## Evidence

- Search with your own web search tool. Search results are pointers: the evidence text must come from the page.
- `hd fetch <run> <claim_id> "<url>"` downloads the page and prints the passages most relevant to the claim, with IDs such as `E4.1`. In the result, refer to evidence by its ID; hd fills in the text, so it cannot be miscopied.
- `hd search <run> <claim_id> "<query>"` searches a local SearXNG (at `SEARXNG_URL`, default `http://localhost:8888`) and stores the snippets with IDs.
- A page hd cannot read (PDF, blocked, rendered by scripts) may be read with your own tools and added inline with `url`, `title` and a `text` copied from the page. Inline evidence is **unconfirmed**: it never decides a verdict on its own; the judge weighs it.
- If hd has no network access (some agents run commands without network), the tasks say so: use your own fetch and inline evidence.

## Which claims go to the judge

hd decides in code:
- VERIFIED: the evidence supports the claim and at least one supporting item is confirmed.
- HALLUCINATION: confirmed evidence from at least two different websites contradicts the claim.
- UNVERIFIABLE: the verification failed (an error result, or no valid result after the retry).

Everything else goes to a judge task: insufficient evidence, a contradiction by a single website, support that rests only on unconfirmed evidence, and evidence that disagrees with the independent answers.

## Rules the tasks repeat

- Same subject: evidence about a namesake, another event, place or year is neutral.
- Conservative: CONTRADICTED only when the evidence clearly refutes the claim.
- Rounding: a value rounded to the claim's precision is consistent ("35%" for 34.7%).
- Every detail of the claim is checked, including descriptive details such as a profession or nationality.
