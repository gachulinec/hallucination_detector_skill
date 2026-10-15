/**
 * Step 3 (standard mode): web verification. The agent searches with its own
 * tool and gets evidence text through hd fetch / hd search, referring to it by
 * ID; evidence it writes itself counts as unconfirmed (spec §5).
 */

import { NLI_RULES, QUERY_INSTRUCTIONS, type VerificationResult } from "../../method/retrieval.js";
import type { Claim, Evidence } from "../../schemas/index.js";
import { atomicWriteJSON } from "../../utils/atomic-write.js";
import { loadPrompt } from "../../utils/prompts.js";
import { clamp01 } from "../../utils/validate.js";
import { SKILL_LIMITS } from "../config.js";
import { lookupEvidence } from "../evidence-store.js";
import { entriesById, type ResultObject } from "../results.js";
import { readAccepted, readNetwork, updateAccepted } from "../run-state.js";
import { batches, claimsSection, newTask, numberedId, writeTaskFile } from "../tasks.js";
import type { Stage, TaskRecord } from "../types.js";
import {
  addWarning,
  claimMap,
  consistencyMap,
  readClaims,
  type AcceptOutcome,
  type Step,
  type StepContext,
} from "./step.js";

const ACCEPTED = "verify";
const STATUSES: readonly string[] = ["SUPPORTED", "CONTRADICTED", "INSUFFICIENT"];
const RELATIONS: readonly string[] = ["supports", "contradicts", "neutral"];

function issue(ctx: StepContext): TaskRecord[] {
  const ids = readClaims(ctx).claims.map((c) => c.id);
  const groups = batches(ids, SKILL_LIMITS.claimsPerTask.verify[ctx.state.profile]);
  return groups.map((claimIds, i) => {
    const task = newTask({
      id: numberedId("verify", i + 1, groups.length),
      kind: "verify",
      claim_ids: claimIds,
      // A self-check must not verify claims in the context that wrote them
      independence: ctx.state.origin === "self" ? "required" : "recommended",
      model_tier: "standard",
    });
    render(ctx, task);
    return task;
  });
}

function render(ctx: StepContext, task: TaskRecord, feedback?: string): void {
  const { claims, document_title: title } = readClaims(ctx);
  const consistency = consistencyMap(ctx);
  const hd = ctx.state.hd_command;
  const run = `"${ctx.paths.root}"`;
  const thorough = ctx.state.profile === "thorough";
  const inline = '{"url", "title", "text", "relation", "confidence"}';
  const steps = [
    `1. Write ${thorough ? "one or two web search queries" : "one web search query"}. ${QUERY_INSTRUCTIONS}`,
    `2. Search with your web search tool. If you have none, try \`${hd} search ${run} <claim_id> "<query>"\` (it works only when a local SearXNG is running).`,
    readNetwork(ctx.paths) === false
      ? `3. hd has no network access in this environment. Read the most relevant pages with your own tools and add the evidence inline as ${inline}, with the text copied from the page. Inline evidence counts as unconfirmed.`
      : `3. Get the evidence text with \`${hd} fetch ${run} <claim_id> "<url>"\` for the most relevant results (at most ${SKILL_LIMITS.maxFetchesPerClaim} pages per claim). It prints passages of the page with IDs such as E4.1; refer to the evidence by these IDs. A page hd cannot read (PDF, blocked, rendered by scripts) may be read with your own tools and added inline as ${inline}; inline evidence counts as unconfirmed.`,
    `4. For each evidence item decide whether it supports or contradicts the claim or is neutral, with a confidence from 0 to 1; then set the status SUPPORTED, CONTRADICTED or INSUFFICIENT by the rules above. ${NLI_RULES.replace(/\n/g, " ")} Write the explanation in ${ctx.state.language}.`,
    thorough
      ? '5. If the status is INSUFFICIENT, fetch up to 2 more of the top result pages and decide again; then set "escalated": true.'
      : "5. Fetch a full page only when the claim's number is not in the passages you already have.",
  ];
  writeTaskFile(
    ctx,
    task,
    {
      title: "verify the claims with web evidence",
      body: [
        loadPrompt("retrieval-verifier"),
        "",
        "## How to work",
        "",
        "Do this for each claim below:",
        "",
        ...steps,
        "",
        `At most ${SKILL_LIMITS.maxEvidencePerClaim} evidence items per claim. SUPPORTED needs at least one supporting item, CONTRADICTED at least one contradicting item. List the queries you used in "search_queries".`,
        "",
        "## Claims",
        "",
        claimsSection(claims.filter((c) => task.claim_ids.includes(c.id)), title, (claim) => {
          const c = consistency.get(claim.id);
          return c
            ? `Consistency score: ${c.consistency_score} (share of independent answers that state the same fact as the claim)`
            : undefined;
        }),
      ].join("\n"),
      output:
        '{"executed_by": "subagent", "results": [{"claim_id": 4, "search_queries": ["Eiffel Tower height"], "evidence": [{"id": "E4.1", "relation": "contradicts", "confidence": 0.9}, {"url": "https://example.org/page", "title": "Example", "text": "text copied from the page", "relation": "neutral", "confidence": 0.5}], "verification_status": "CONTRADICTED", "explanation": "...", "escalated": false}]}',
      outputRules: [
        "One result per claim, for every claim listed.",
        "This output format replaces the one described in the rules above.",
      ],
    },
    feedback
  );
}

function parseEvidence(ctx: StepContext, claimId: number, item: unknown): Evidence | string {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return "is not an object";
  const fields = item as ResultObject;
  const relation = typeof fields.relation === "string" ? fields.relation.trim().toLowerCase() : "";
  if (!RELATIONS.includes(relation)) {
    return `has the relation ${JSON.stringify(fields.relation)}; use supports, contradicts or neutral`;
  }
  const support_relation = relation as Evidence["support_relation"];
  const confidence = clamp01(fields.confidence, 0.6);

  if (typeof fields.id === "string" && fields.id.trim()) {
    const stored = lookupEvidence(ctx.paths, claimId, fields.id);
    if (!stored) {
      return `refers to ${fields.id}, which does not exist for claim ${claimId}; use the IDs that hd fetch or hd search printed for this claim`;
    }
    return {
      source_url: stored.url,
      source_title: stored.title,
      relevant_text: stored.text,
      retrieval_method: "web_search",
      support_relation,
      confidence,
      checked: true,
    };
  }

  const url = typeof fields.url === "string" ? fields.url.trim() : "";
  const text = typeof fields.text === "string" ? fields.text.trim() : "";
  if (!/^https?:\/\//i.test(url) || text.length < 15) {
    return 'needs either an "id" printed by hd, or "url" (a web address) and "text" (at least a sentence copied from the page)';
  }
  return {
    source_url: url,
    source_title: typeof fields.title === "string" && fields.title.trim() ? fields.title.trim() : url,
    relevant_text: text.slice(0, SKILL_LIMITS.passageChars),
    retrieval_method: "web_search",
    support_relation,
    confidence,
    checked: false,
  };
}

type Parsed = { result: VerificationResult } | { problems: string[] };

function parseResult(ctx: StepContext, task: TaskRecord, claim: Claim, entry: ResultObject): Parsed {
  const problems: string[] = [];
  const queries = Array.isArray(entry.search_queries)
    ? entry.search_queries.filter((q): q is string => typeof q === "string" && q.trim().length > 0)
    : [];
  if (queries.length === 0) problems.push('"search_queries" must list the queries you used');

  const status = typeof entry.verification_status === "string" ? entry.verification_status.trim().toUpperCase() : "";
  if (!STATUSES.includes(status)) {
    problems.push(`"verification_status" is ${JSON.stringify(entry.verification_status)}; use SUPPORTED, CONTRADICTED or INSUFFICIENT`);
  }

  if (entry.evidence !== undefined && !Array.isArray(entry.evidence)) problems.push('"evidence" must be an array');
  const rawEvidence: unknown[] = Array.isArray(entry.evidence) ? entry.evidence : [];
  if (rawEvidence.length > SKILL_LIMITS.maxEvidencePerClaim) {
    problems.push(`at most ${SKILL_LIMITS.maxEvidencePerClaim} evidence items, not ${rawEvidence.length}`);
  }
  const evidence: Evidence[] = [];
  rawEvidence.slice(0, SKILL_LIMITS.maxEvidencePerClaim).forEach((item, i) => {
    const parsed = parseEvidence(ctx, claim.id, item);
    if (typeof parsed === "string") problems.push(`evidence item ${i + 1} ${parsed}`);
    else evidence.push(parsed);
  });

  if (status === "SUPPORTED" && !evidence.some((e) => e.support_relation === "supports")) {
    problems.push("SUPPORTED needs at least one evidence item with the relation supports");
  }
  if (status === "CONTRADICTED" && !evidence.some((e) => e.support_relation === "contradicts")) {
    problems.push("CONTRADICTED needs at least one evidence item with the relation contradicts");
  }
  if (
    status === "INSUFFICIENT" &&
    ctx.state.profile === "thorough" &&
    task.attempt === 1 &&
    entry.escalated !== true &&
    readNetwork(ctx.paths) !== false
  ) {
    problems.push('the status is INSUFFICIENT: fetch up to 2 more of the top result pages, decide again and set "escalated": true');
  }
  if (problems.length > 0) return { problems };

  return {
    result: {
      claim_id: claim.id,
      claim_text: claim.text,
      search_queries: queries,
      evidence,
      verification_status: status as VerificationResult["verification_status"],
      explanation: typeof entry.explanation === "string" ? entry.explanation : "",
      ...(entry.escalated === true ? { escalated: true } : {}),
    },
  };
}

function accept(ctx: StepContext, task: TaskRecord, value: ResultObject): AcceptOutcome {
  const entries = entriesById(value.results, "claim_id");
  const claims = claimMap(ctx);
  const problems: string[] = [];
  const retry: number[] = [];
  for (const id of task.claim_ids) {
    const claim = claims.get(id);
    if (!claim) continue;
    const entry = entries.get(id);
    const parsed: Parsed = entry ? parseResult(ctx, task, claim, entry) : { problems: ["no result for this claim"] };
    if ("result" in parsed) {
      updateAccepted(ctx.paths, ACCEPTED, id, parsed.result);
    } else {
      problems.push(`Claim ${id}: ${parsed.problems.join("; ")}.`);
      retry.push(id);
    }
  }
  return retry.length > 0 ? { retry: { feedback: problems.join("\n"), claimIds: retry } } : {};
}

function errorResult(claimId: number, claimText: string, reason: string): VerificationResult {
  return {
    claim_id: claimId,
    claim_text: claimText,
    search_queries: [],
    evidence: [],
    verification_status: "INSUFFICIENT",
    explanation: `Error: ${reason}`,
    error: reason,
  };
}

function fail(ctx: StepContext, task: TaskRecord, reason: string, claimIds: number[] = task.claim_ids): void {
  const claims = claimMap(ctx);
  for (const id of claimIds) {
    updateAccepted(ctx.paths, ACCEPTED, id, errorResult(id, claims.get(id)?.text ?? "", reason));
  }
}

function complete(ctx: StepContext): Stage {
  const accepted = readAccepted<VerificationResult>(ctx.paths, ACCEPTED);
  const results = readClaims(ctx).claims.map((c) => accepted[c.id] ?? errorResult(c.id, c.text, "no verification result"));
  atomicWriteJSON(ctx.paths.evidence, { results });

  const failed = results.filter((r) => r.error).length;
  if (results.length > 0 && failed === results.length) {
    ctx.state.failure =
      "Web search was unavailable for every claim, so standard mode cannot run. Make web search available (or start a local SearXNG) and run the check again.";
    return "failed";
  }
  if (failed > 0) {
    addWarning(ctx.state, `${failed} of ${results.length} claims could not be verified (search or model errors) and are marked UNVERIFIABLE.`);
  }
  if (readNetwork(ctx.paths) === false) {
    addWarning(
      ctx.state,
      "hd had no network access, so no evidence could be checked against its page; claims that rest on such evidence went to the judge. Allow network access for the agent's shell commands to fix this."
    );
  } else {
    const unconfirmed = results.flatMap((r) => r.evidence).filter((e) => e.checked === false).length;
    if (unconfirmed > 0) {
      addWarning(
        ctx.state,
        `${unconfirmed} evidence items were written by the verifying agent and could not be checked against their pages; claims that rest on them went to the judge.`
      );
    }
  }
  return "judge";
}

export const verifyStep: Step = { stage: "verify", issue, render, accept, fail, complete };
