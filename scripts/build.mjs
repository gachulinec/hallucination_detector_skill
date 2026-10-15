#!/usr/bin/env node
/**
 * Bundles the hd CLI (src/hd/cli.ts) into one dependency-free file for the
 * skill folder, with the prompts embedded, and writes the licenses of the
 * bundled packages next to it.
 *
 *   node scripts/build.mjs                 # hallucination-check/scripts/hd.mjs
 *   node scripts/build.mjs --outdir <dir>  # <dir>/hd.mjs and <dir>/THIRD_PARTY_NOTICES.md (tests)
 */

import { build } from "esbuild";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = join(root, "hallucination-check");
const outdirFlag = process.argv.indexOf("--outdir");
const outdir = outdirFlag >= 0 ? resolve(process.argv[outdirFlag + 1]) : join(skillDir, "scripts");
const noticesFile = outdirFlag >= 0 ? join(outdir, "THIRD_PARTY_NOTICES.md") : join(skillDir, "THIRD_PARTY_NOTICES.md");

/** Replaces src/utils/prompts.ts with a module that holds the prompts as strings. */
const embedPrompts = {
  name: "embed-prompts",
  setup(b) {
    b.onLoad({ filter: /[\\/]src[\\/]utils[\\/]prompts\.ts$/ }, () => {
      const dir = join(root, "src", "prompts");
      const prompts = Object.fromEntries(
        readdirSync(dir)
          .filter((f) => f.endsWith(".md"))
          .sort()
          .map((f) => [f.slice(0, -3), readFileSync(join(dir, f), "utf-8")])
      );
      return {
        loader: "js",
        contents: [
          `const PROMPTS = ${JSON.stringify(prompts)};`,
          "export const PROMPT_NAMES = Object.keys(PROMPTS);",
          "export function loadPrompt(name) {",
          "  const prompt = PROMPTS[name];",
          '  if (prompt === undefined) throw new Error("Unknown prompt " + name);',
          "  return prompt;",
          "}",
        ].join("\n"),
      };
    });
  },
};

mkdirSync(outdir, { recursive: true });
const result = await build({
  entryPoints: [join(root, "src", "hd", "cli.ts")],
  outfile: join(outdir, "hd.mjs"),
  // Paths in the bundle's comments are relative to the project, so every build is identical
  absWorkingDir: root,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Bundled CommonJS packages call require, which ESM output must define
  banner: { js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);" },
  // linkedom loads canvas only if it is installed; it is not needed
  external: ["canvas"],
  legalComments: "inline",
  metafile: true,
  plugins: [embedPrompts],
  logLevel: "warning",
});

const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (match) packages.add(match[1]);
}
const sections = [...packages].sort().map((name) => {
  const pkgDir = join(root, "node_modules", name);
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8"));
  const licenseFile = readdirSync(pkgDir).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
  const text = licenseFile
    ? readFileSync(join(pkgDir, licenseFile), "utf-8").trim()
    : `License: ${pkg.license ?? "unknown"} (the package has no license file)`;
  return `## ${pkg.name} ${pkg.version} (${pkg.license ?? "unknown"})\n\n${text}\n`;
});
writeFileSync(
  noticesFile,
  `# Third-party notices\n\n\`scripts/hd.mjs\` bundles these packages:\n\n${sections.join("\n")}`,
  "utf-8"
);
console.log(`Built ${join(outdir, "hd.mjs")} with ${packages.size} bundled packages`);
