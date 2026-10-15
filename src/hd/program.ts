/** The hd command line; scripts/build.mjs bundles it into the skill folder. */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command, Option } from "commander";
import { METHOD } from "../method/config.js";
import { createPageFetcher } from "../utils/page-fetcher.js";
import { createSearxngSearcher } from "../utils/searxng-search.js";
import { SKILL_LIMITS, SKILL_VERSION } from "./config.js";
import { fetchForClaim, searchForClaim, type EvidenceOutcome } from "./evidence-store.js";
import { formatEvidence, formatNext } from "./format.js";
import { runNext, runStatus, type NextOutput } from "./next.js";
import { toClaimId } from "./results.js";
import { createRun, DEFAULT_DIR, runPaths } from "./run-state.js";
import type { Origin, Profile } from "./types.js";

interface JsonOption {
  json?: boolean;
}

interface InitOptions extends JsonOption {
  text: string;
  source?: string;
  profile?: Profile;
  origin: Origin;
  lang: string;
  subagents: boolean;
  agent?: string;
  model?: string[];
  dir: string;
}

interface FetchOptions extends JsonOption {
  title?: string;
}

function print(json: boolean | undefined, value: unknown, text: string): void {
  console.log(json ? JSON.stringify(value, null, 2) : text);
}

function printNext(out: NextOutput, json: boolean | undefined, prefix = ""): void {
  print(json, out, `${prefix}${formatNext(out)}`);
  if (out.failure) process.exitCode = 1;
}

function printEvidence(outcome: EvidenceOutcome, json: boolean | undefined): void {
  print(json, outcome, outcome.ok ? formatEvidence(outcome.items) : outcome.message);
  if (!outcome.ok) process.exitCode = 1;
}

function claimIdArg(value: string): number {
  const id = toClaimId(value);
  if (id === null) throw new Error(`Not a claim ID: ${value}`);
  return id;
}

export function buildProgram(hdPath: string): Command {
  const hdCommand = `node "${hdPath}"`;
  const program = new Command();
  program
    .name("hd")
    .description("hallucination-check: gives the agent its tasks one step at a time and checks every result in code")
    .version(SKILL_VERSION);

  program
    .command("init")
    .description("start a check and print the first tasks")
    .requiredOption("--text <file>", "the text to check")
    .option("--source <file>", "source document (faithfulness mode)")
    .addOption(new Option("--profile <profile>", "thorough or quick (default: thorough; quick with --origin self)").choices(["thorough", "quick"]))
    .addOption(new Option("--origin <origin>", "external: a text to check; self: your own draft").choices(["external", "self"]).default("external"))
    .option("--lang <language>", "language of the explanations in the report", "English")
    .option("--no-subagents", "you cannot start subagents")
    .option("--agent <name>", "your product name, recorded in the report")
    .option("--model <ids...>", "the model IDs you use, recorded in the report")
    .option("--dir <path>", "directory for runs", DEFAULT_DIR)
    .option("--json", "print JSON")
    .action((options: InitOptions) => {
      const paths = createRun({
        textFile: options.text,
        sourceFile: options.source,
        profile: options.profile ?? (options.origin === "self" ? "quick" : "thorough"),
        origin: options.origin,
        language: options.lang,
        subagents: options.subagents,
        agent: options.agent,
        models: options.model ?? [],
        dir: options.dir,
        writeGitignore: resolve(options.dir) === resolve(DEFAULT_DIR),
        hdCommand,
      });
      printNext(runNext(paths.root), options.json, `Run: ${paths.root}\n`);
    });

  program
    .command("next")
    .description("check the results written so far and print the next tasks")
    .argument("<run>", "run directory")
    .option("--json", "print JSON")
    .action((run: string, options: JsonOption) => printNext(runNext(run), options.json));

  program
    .command("status")
    .description("show where a run is, without reading new results")
    .argument("<run>", "run directory")
    .option("--json", "print JSON")
    .action((run: string, options: JsonOption) => printNext(runStatus(run), options.json));

  program
    .command("fetch")
    .description("download a page and print evidence passages for a claim")
    .argument("<run>", "run directory")
    .argument("<claim_id>", "claim ID")
    .argument("<url>", "page address")
    .option("--title <title>", "page title")
    .option("--json", "print JSON")
    .action(async (run: string, claimId: string, url: string, options: FetchOptions) => {
      const fetcher = createPageFetcher({ directTimeoutMs: SKILL_LIMITS.fetchTimeoutMs });
      printEvidence(await fetchForClaim(runPaths(run), claimIdArg(claimId), url, options.title, (u) => fetcher.fetchPageText(u)), options.json);
    });

  program
    .command("search")
    .description("search a local SearXNG (SEARXNG_URL) and print evidence snippets for a claim")
    .argument("<run>", "run directory")
    .argument("<claim_id>", "claim ID")
    .argument("<query>", "search query")
    .option("--json", "print JSON")
    .action(async (run: string, claimId: string, query: string, options: JsonOption) => {
      const searcher = createSearxngSearcher({
        baseUrl: METHOD.searxng_url,
        minIntervalMs: METHOD.searxng_min_interval_ms,
        retryDelaysMs: [5_000],
      });
      printEvidence(await searchForClaim(runPaths(run), claimIdArg(claimId), query, (q) => searcher.search(q)), options.json);
    });

  program
    .command("summary")
    .description("print the short result of a finished run")
    .argument("<run>", "run directory")
    .action((run: string) => {
      const paths = runPaths(run);
      if (!existsSync(paths.summary)) {
        console.error("The run is not finished yet: run hd next until it prints DONE.");
        process.exitCode = 1;
        return;
      }
      console.log(readFileSync(paths.summary, "utf-8"));
    });

  return program;
}
