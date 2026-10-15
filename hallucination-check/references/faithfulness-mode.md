# Faithfulness mode (source document)

For a text that must say only what a given source says: a summary of an article, a report based on a document. No web and no outside knowledge, like NotebookLM.

## Steps

| Step | Tasks | Who | What hd checks |
|---|---|---|---|
| extract | `extract-NN` | subagent recommended | as in standard mode |
| ground | `ground-NN`, 8 claims each (12 in the quick profile) | **fresh subagent** | every SUPPORTED or CONTRADICTED answer quotes the source verbatim; a SUPPORTED quote states the claim's number |

## How a ground task works

- Sources up to 120,000 characters: the subagent reads the whole `input/source.md` of the run, in parts if its file reader limits size. Longer sources: each claim comes with the passages of the source most relevant to it.
- Status SUPPORTED, CONTRADICTED or NOT_IN_SOURCE. NOT_IN_SOURCE means the source does not say it: the claim is reported as a hallucination (an unsupported detail), with lower confidence than a contradiction.
- A quote that hd cannot find in the source gets one retry. Switching to NOT_IN_SOURCE after a rejected quote is not accepted: the claim becomes UNVERIFIABLE.
- An approximate value that is the source's value rounded ("about 380" for 375.5) is SUPPORTED; code decides this.

## Why a fresh subagent

The check must use the source only. A context that has read the text, the conversation or the web brings outside knowledge in. When the agent wrote the summary itself, it also tends to read its own words into the source.
