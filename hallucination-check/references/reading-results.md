# Presenting the result

After `DONE`, read the run's `summary.md` (`hd summary <run>`) and present it in the user's language:

1. **Hallucinations first.** For each: the claim, what the evidence or the source says instead, and where (the URL, or the quote from the source document). Say when the evidence is marked unconfirmed.
2. **Unverifiable claims.** Say why each could not be verified. UNVERIFIABLE does not mean false: the check found too little to decide.
3. **Warnings.** Name every warning: it means the result is partial (for example, a part of the text could not be processed, or independence was not ensured).
4. **No finding is not proof.** The method flags a claim only on clear evidence, so a clean result does not prove the text correct.

Report what the check found; do not change verdicts or add your own. If you disagree with a verdict, say so separately and why.

## In a self-check

After presenting the result, fix the draft: correct or remove each hallucinated claim, and soften or source the unverifiable ones. Tell the user what you changed. To check the corrected draft, run the skill again on the whole text.

## Files of a run

| File | Content |
|---|---|
| `summary.md` | the short result |
| `report.json` | all verdicts with evidence, counts, warnings, `run_info` (how the check ran) |
| `annotated_text.md` | the text with a marker at each claim |
| `claims.json`, `evidence.json`, `verdicts.json` | intermediate results |
