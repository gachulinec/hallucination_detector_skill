import { execFile, execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { HallucinationReportSchema } from "../../src/schemas/index.js";
import type { NextOutput } from "../../src/hd/next.js";
import { fakeAgentDo, type FakeWorld } from "./fake-agent.js";
import { FAITH_SOURCE, FAITH_TEXT, PAGE_TEXT, STANDARD_TEXT } from "./helpers.js";

const PAGE_HTML = `<!doctype html><html><head><title>Eiffel Tower</title></head><body><article><h1>Eiffel Tower</h1><p>${PAGE_TEXT}</p><p>${PAGE_TEXT}</p></article></body></html>`;

let outDir = "";
let hd = "";
let base = "";
let server: Server;

beforeAll(async () => {
  // Built into a temporary directory: no node_modules above it, as for a user who copied the skill
  outDir = mkdtempSync(join(tmpdir(), "hd-bundle-"));
  execFileSync(process.execPath, ["scripts/build.mjs", "--outdir", outDir], { stdio: "pipe" });
  hd = join(outDir, "hd.mjs");
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE_HTML);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(() => new Promise<void>((done) => server.close(() => done())));

function hdRun(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [hd, ...args], { cwd, encoding: "utf-8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function hdJson<T>(args: string[], cwd: string): T {
  const r = hdRun([...args, "--json"], cwd);
  if (!r.stdout.trim()) throw new Error(`hd ${args.join(" ")} printed nothing: ${r.stderr}`);
  return JSON.parse(r.stdout) as T;
}

const execFileAsync = promisify(execFile);

/** hd called without blocking: the page server in this process must keep answering while hd fetches from it. */
async function hdJsonAsync<T>(args: string[], cwd: string): Promise<T> {
  const { stdout } = await execFileAsync(process.execPath, [hd, ...args, "--json"], { cwd, encoding: "utf-8" }).catch(
    (error: { stdout?: string }) => ({ stdout: error.stdout ?? "" })
  );
  return JSON.parse(stdout) as T;
}

function world(cwd: string): FakeWorld {
  return {
    wrong: ["1899"],
    pageUrl: (claim) => `${base}/claim-${claim.id}`,
    fetchEvidence: async (root, claimId, url) => {
      const out = await hdJsonAsync<{ ok: boolean; items?: Array<{ id: string }> }>(["fetch", root, String(claimId), url], cwd);
      return out.ok ? (out.items ?? []).map((item) => item.id) : [];
    },
  };
}

async function loop(first: NextOutput, cwd: string): Promise<NextOutput> {
  let out = first;
  for (let i = 0; i < 20 && !out.done && !out.failure; i++) {
    await fakeAgentDo(out.run, out.tasks, world(cwd));
    out = hdJson<NextOutput>(["next", out.run], cwd);
  }
  return out;
}

describe("bundled hd", () => {
  test("runs a standard check in a directory with spaces and diacritics", async () => {
    const cwd = join(mkdtempSync(join(tmpdir(), "hd-e2e-")), "runs ľ");
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, "text.md"), STANDARD_TEXT);
    const first = hdJson<NextOutput>(["init", "--text", "text.md", "--agent", "fake-agent"], cwd);
    expect(first.tasks[0].task_file).toContain("runs ľ");

    const out = await loop(first, cwd);
    expect(out.failure).toBeUndefined();
    expect(out.counts).toEqual({ claims: 3, hallucination: 1, unverifiable: 0, verified: 2 });
    expect(existsSync(join(cwd, ".hallucination-check", ".gitignore"))).toBe(true);
    const report = HallucinationReportSchema.parse(JSON.parse(readFileSync(join(out.run, "report.json"), "utf-8")));
    expect(report.run_info?.agent).toBe("fake-agent");
    expect(report.run_info?.network).toBe(true);
    expect(hdRun(["summary", out.run], cwd).stdout).toContain("## Hallucinations");
    expect(hdRun(["status", out.run], cwd).stdout).toContain("DONE.");
  }, 60_000);

  test("runs a faithfulness check", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "hd-e2e-"));
    writeFileSync(join(cwd, "text.md"), FAITH_TEXT);
    writeFileSync(join(cwd, "source.md"), FAITH_SOURCE);
    const out = await loop(hdJson<NextOutput>(["init", "--text", "text.md", "--source", "source.md"], cwd), cwd);
    expect(out.counts).toEqual({ claims: 2, hallucination: 1, unverifiable: 0, verified: 1 });
  }, 60_000);

  // Review finding (reproduced): parallel hd fetch processes for one claim printed the same IDs and one page was lost
  test("keeps the evidence of parallel fetches for one claim apart", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "hd-e2e-"));
    writeFileSync(join(cwd, "text.md"), STANDARD_TEXT);
    const first = hdJson<NextOutput>(["init", "--text", "text.md"], cwd);
    await fakeAgentDo(first.run, first.tasks, world(cwd));
    hdJson<NextOutput>(["next", first.run], cwd);

    // Answers only when all four requests have arrived, so the four processes store their passages at the same moment
    const waiting: Array<() => void> = [];
    const barrier = createServer((_req, res) => {
      waiting.push(() => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(PAGE_HTML);
      });
      if (waiting.length === 4) for (const answer of waiting) answer();
    });
    await new Promise<void>((done) => barrier.listen(0, "127.0.0.1", done));
    const port = (barrier.address() as AddressInfo).port;
    const outs = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        hdJsonAsync<{ ok: boolean; items?: Array<{ id: string; url: string }> }>(["fetch", first.run, "1", `http://127.0.0.1:${port}/page-${n}`], cwd)
      )
    );
    await new Promise<void>((done) => barrier.close(() => done()));

    const printed = outs.flatMap((o) => o.items ?? []);
    expect(new Set(printed.map((i) => i.id)).size).toBe(printed.length);
    const store = JSON.parse(readFileSync(join(first.run, "passages", "claim_1.json"), "utf-8")) as {
      fetched_urls: string[];
      items: Array<{ id: string; url: string }>;
    };
    expect(store.fetched_urls).toHaveLength(4);
    expect(store.items).toHaveLength(printed.length);
    for (const item of printed) expect(store.items.find((s) => s.id === item.id)?.url).toBe(item.url);
  }, 60_000);

  test("names the cause of a network error and keeps the network flag for one unreachable site", async () => {
    // A port that was just closed refuses connections
    const closed = createServer();
    await new Promise<void>((done) => closed.listen(0, "127.0.0.1", done));
    const deadPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((done) => closed.close(() => done()));
    const cwd = mkdtempSync(join(tmpdir(), "hd-e2e-"));
    writeFileSync(join(cwd, "text.md"), STANDARD_TEXT);
    const first = hdJson<NextOutput>(["init", "--text", "text.md"], cwd);
    writeFileSync(
      join(first.run, "claims.json"),
      JSON.stringify({ claims: [{ id: 1, text: "c", type: "factual", original_sentence: "c", source_position: { start: 0, end: 0 } }] })
    );
    const out = hdRun(["fetch", first.run, "1", `http://127.0.0.1:${deadPort}/dead`], cwd);
    expect(out.stdout).toContain("ECONNREFUSED");
    expect(out.stdout).toContain("Could not read");
    const flag = JSON.parse(readFileSync(join(first.run, "network.json"), "utf-8")) as { network: boolean | null };
    expect(flag.network).toBeNull();
  });

  // Review finding (reproduced): exiting right after printing cut piped output at 64 KB
  test("prints long output completely through a pipe", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hd-e2e-"));
    writeFileSync(join(cwd, "text.md"), STANDARD_TEXT);
    const first = hdJson<NextOutput>(["init", "--text", "text.md"], cwd);
    const long = "A long summary line that repeats.\n".repeat(10_000);
    writeFileSync(join(first.run, "summary.md"), long);
    expect(hdRun(["summary", first.run], cwd).stdout.length).toBe(long.length + 1);
  });

  // Review finding: a mistyped run path said "The run is not finished yet" or "The claims are not extracted yet"
  test("says that a mistyped run path is not a run", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hd-e2e-"));
    const summary = hdRun(["summary", "runs/typo"], cwd);
    expect(summary.status).toBe(1);
    expect(summary.stderr).toContain("No run at");
    const fetched = hdRun(["fetch", "runs/typo", "1", "https://example.org"], cwd);
    expect(fetched.status).toBe(1);
    expect(fetched.stderr).toContain("No run at");
  });

  test("prints its version and ships the licenses of the bundled packages", () => {
    expect(hdRun(["--version"], outDir).stdout.trim()).toBe("1.0.1");
    const notices = readFileSync(join(outDir, "THIRD_PARTY_NOTICES.md"), "utf-8");
    expect(notices).toContain("@mozilla/readability");
    expect(notices).toContain("linkedom");
  });

  test("explains an unknown run on stderr and exits with 1", () => {
    const r = hdRun(["next", join(outDir, "missing-run")], outDir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("hd init");
  });
});
