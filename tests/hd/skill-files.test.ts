import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { SKILL_VERSION } from "../../src/hd/config.js";

const skillDir = fileURLToPath(new URL("../../hallucination-check/", import.meta.url));
const skillMd = existsSync(join(skillDir, "SKILL.md")) ? readFileSync(join(skillDir, "SKILL.md"), "utf-8") : "";
const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skillMd)?.[1] ?? "";
const field = (name: string): string | undefined => new RegExp(`^${name}: (.*)$`, "m").exec(frontmatter)?.[1]?.trim();

describe("skill folder", () => {
  test("SKILL.md frontmatter uses only fields of the open standard", () => {
    const keys = frontmatter
      .split("\n")
      .filter((line) => /^[a-z-]+:/.test(line))
      .map((line) => line.split(":")[0]);
    expect(keys).toEqual(["name", "description", "license", "compatibility", "metadata"]);
    expect(field("name")).toBe("hallucination-check");
    expect(field("license")).toBe("MIT");
    expect(field("compatibility")).toBe(
      "Requires Node.js 20+ and shell access; standard mode needs a web search tool; subagents recommended."
    );
    const description = field("description") ?? "";
    expect(description.length).toBeGreaterThan(200);
    expect(description.length).toBeLessThanOrEqual(1024);
    // A ": " inside a plain YAML scalar would break the frontmatter
    expect(description).not.toContain(": ");
    expect(frontmatter).toContain(`  version: "${SKILL_VERSION}"`);
  });

  test("SKILL.md is short and links only to files that exist", () => {
    expect(skillMd.split("\n").length).toBeLessThanOrEqual(200);
    const links = [...skillMd.matchAll(/references\/[a-z-]+\.md/g)].map((m) => m[0]);
    expect(new Set(links).size).toBe(4);
    for (const link of links) expect(existsSync(join(skillDir, link))).toBe(true);
    for (const file of ["scripts/hd.mjs", "LICENSE", "THIRD_PARTY_NOTICES.md"]) {
      expect(existsSync(join(skillDir, file))).toBe(true);
    }
  });

  test("the committed bundle is current", () => {
    const out = mkdtempSync(join(tmpdir(), "hd-current-"));
    execFileSync(process.execPath, ["scripts/build.mjs", "--outdir", out], { stdio: "pipe" });
    expect(readFileSync(join(out, "hd.mjs"), "utf-8")).toBe(readFileSync(join(skillDir, "scripts", "hd.mjs"), "utf-8"));
  }, 60_000);
});
