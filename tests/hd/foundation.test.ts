import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { normalizeText, sentenceInText, uncoveredNumbers } from "../../src/hd/checks.js";
import { entriesById, parseResultText, readResult, toClaimId } from "../../src/hd/results.js";
import {
  createRun,
  loadState,
  readAccepted,
  readNetwork,
  updateAccepted,
  writeNetwork,
  type CreateRunInput,
} from "../../src/hd/run-state.js";
import { normalizeForMatch } from "../../src/utils/quote-match.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "hd-foundation-"));
}

function runInput(dir: string, text = "Text.", extra: Partial<CreateRunInput> = {}): CreateRunInput {
  const textFile = join(dir, "text.md");
  writeFileSync(textFile, text);
  return {
    textFile,
    dir: join(dir, "work"),
    writeGitignore: false,
    hdCommand: 'node "/skill/scripts/hd.mjs"',
    profile: "thorough",
    origin: "external",
    language: "English",
    subagents: true,
    models: [],
    ...extra,
  };
}

describe("createRun", () => {
  test("creates the run directory with the inputs and the state", () => {
    const dir = tempDir();
    const paths = createRun(runInput(dir, "Text.", { writeGitignore: true, now: new Date("2026-10-14T10:00:00Z") }));
    expect(paths.root).toBe(join(dir, "work", "runs", "2026-10-14T10-00-00"));
    expect(readFileSync(paths.text, "utf-8")).toBe("Text.");
    expect(readFileSync(join(dir, "work", ".gitignore"), "utf-8")).toBe("*\n");
    expect(loadState(paths)).toMatchObject({
      version: "1.0.0",
      mode: "standard",
      stage: "extract",
      profile: "thorough",
      hd_command: 'node "/skill/scripts/hd.mjs"',
      tasks: [],
      warnings: [],
    });
  });

  test("gives a second run in the same second its own directory", () => {
    const dir = tempDir();
    const now = new Date("2026-10-14T10:00:00Z");
    const first = createRun(runInput(dir, "Text.", { now }));
    const second = createRun(runInput(dir, "Text.", { now }));
    expect(second.root).toBe(`${first.root}-2`);
  });

  test("makes a run with a source document a faithfulness run", () => {
    const dir = tempDir();
    const sourceFile = join(dir, "source.md");
    writeFileSync(sourceFile, "Source.");
    const paths = createRun(runInput(dir, "Text.", { sourceFile }));
    expect(loadState(paths).mode).toBe("faithfulness");
    expect(readFileSync(paths.source, "utf-8")).toBe("Source.");
  });

  test("refuses an empty text and writes no .gitignore unless asked", () => {
    const dir = tempDir();
    expect(() => createRun(runInput(dir, "  \n"))).toThrow(/is empty/);
    createRun(runInput(dir));
    expect(existsSync(join(dir, "work", ".gitignore"))).toBe(false);
  });

  test("loadState explains a missing run", () => {
    const dir = tempDir();
    const paths = createRun(runInput(dir));
    expect(() => loadState({ ...paths, state: join(dir, "nope.json") })).toThrow(/hd init/);
  });
});

describe("accepted stores and the network flag", () => {
  test("keeps accepted values by key", () => {
    const paths = createRun(runInput(tempDir()));
    expect(readAccepted<string>(paths, "questions")).toEqual({});
    updateAccepted(paths, "questions", 3, "Q3");
    updateAccepted(paths, "questions", 4, "Q4");
    expect(readAccepted<string>(paths, "questions")).toEqual({ "3": "Q3", "4": "Q4" });
  });

  test("knows nothing about the network until a fetch tells it", () => {
    const paths = createRun(runInput(tempDir()));
    expect(readNetwork(paths)).toBeNull();
    writeNetwork(paths, { network: false, reason: "fetch failed" });
    expect(readNetwork(paths)).toBe(false);
  });
});

describe("result files", () => {
  test("parse JSON inside a code fence or with text around it", () => {
    expect(parseResultText('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(parseResultText('Here it is:\n{"a": 1}\nDone.')).toEqual({ a: 1 });
    expect(parseResultText("[1, 2]")).toBeNull();
    expect(parseResultText("not json")).toBeNull();
  });

  test("give executed_by and an error result", () => {
    const file = join(tempDir(), "r.json");
    writeFileSync(file, '{"executed_by": "Subagent", "error": " no web search "}');
    expect(readResult(file)).toEqual({
      state: "ok",
      value: { executed_by: "Subagent", error: " no web search " },
      executedBy: "subagent",
      error: "no web search",
    });
  });

  test("treat a broken file that changed just now as still being written", () => {
    const file = join(tempDir(), "r.json");
    writeFileSync(file, '{"claims": [');
    const mtime = statSync(file).mtimeMs;
    expect(readResult(file, mtime + 500).state).toBe("settling");
    expect(readResult(file, mtime + 5_000).state).toBe("invalid");
  });

  test("report a missing file", () => {
    expect(readResult(join(tempDir(), "none.json")).state).toBe("missing");
  });

  test("accept claim IDs written as strings", () => {
    expect(toClaimId("4")).toBe(4);
    expect(toClaimId(" 12 ")).toBe(12);
    expect(toClaimId(4)).toBe(4);
    expect(toClaimId("4a")).toBeNull();
    expect(toClaimId(4.5)).toBeNull();
  });

  test("key entries by ID and ignore duplicates and junk", () => {
    const map = entriesById([{ claim_id: "1", q: "a" }, { claim_id: 1, q: "b" }, 7, null, { q: "no id" }, { claim_id: 2, q: "c" }], "claim_id");
    expect([...map.keys()]).toEqual([1, 2]);
    expect(map.get(1)?.q).toBe("a");
    expect(entriesById("nope", "claim_id").size).toBe(0);
  });
});

describe("checks", () => {
  test("sentenceInText ignores case, whitespace, quote marks and diacritics", () => {
    const text = normalizeForMatch("Spišský hrad zničil v roku 1780 „veľký“ požiar.");
    expect(sentenceInText('Spissky hrad  znicil v roku 1780 "velky" poziar.', text)).toBe(true);
    expect(sentenceInText("Spišský hrad zničil požiar v roku 1781.", text)).toBe(false);
    expect(sentenceInText("   ", text)).toBe(false);
  });

  test("uncoveredNumbers lists the numbers no claim of the sentence states", () => {
    const text = "# Report 2024\n\n1. The tower was completed in 1889 and opened in 1890.\n\n| Year | Visitors |\n|---|---|\n| 2023 | 6 |\n";
    const claims = [{ text: "The tower was completed in 1889", original_sentence: "The tower was completed in 1889 and opened in 1890." }];
    expect(uncoveredNumbers(text, claims)).toEqual([
      { sentence: "The tower was completed in 1889 and opened in 1890.", numbers: ["1890"] },
    ]);
  });

  // Review finding: AI answers are Markdown; emphasis, link targets and footnote markers made the checks fail
  test("sentenceInText ignores Markdown emphasis, links and footnote markers", () => {
    const text = normalizeText("The tower is **330** metres tall, says [NASA](https://nasa.gov/a/1969)[1].");
    expect(sentenceInText("The tower is 330 metres tall, says NASA.", text)).toBe(true);
    expect(sentenceInText("The tower is **330** metres tall, says [NASA](https://nasa.gov/a/1969)[1].", text)).toBe(true);
  });

  test("uncoveredNumbers ignores digits in link targets and footnote markers", () => {
    const text = "It is **330** m tall [1]. See [the report](https://example.org/2024/report-77).";
    expect(uncoveredNumbers(text, [{ text: "It is 330 m tall", original_sentence: "It is **330** m tall [1]." }])).toEqual([]);
  });

  test("uncoveredNumbers finds a sentence with numbers and no claim", () => {
    expect(uncoveredNumbers("It is 330 m tall. It is in Paris.", [])).toEqual([{ sentence: "It is 330 m tall.", numbers: ["330"] }]);
  });
});
