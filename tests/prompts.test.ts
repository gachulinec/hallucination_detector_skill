import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { loadPrompt, PROMPT_NAMES } from "../src/utils/prompts.js";

describe("loadPrompt", () => {
  test.each([...PROMPT_NAMES])("returns the text of src/prompts/%s.md", (name) => {
    const file = new URL(`../src/prompts/${name}.md`, import.meta.url);
    expect(loadPrompt(name)).toBe(readFileSync(file, "utf-8"));
  });
});
