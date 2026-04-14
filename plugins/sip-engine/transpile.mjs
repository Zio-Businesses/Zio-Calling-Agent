/**
 * SIP Engine Plugin - Server-side TypeScript transpiler
 *
 * Regenerates all paired .ts -> .js files in this plugin directory.
 * The .js files are what Node.js loads at runtime (ESM, no build step at startup).
 *
 * Run from the repo root: node plugins/sip-engine/transpile.mjs
 * Or via npm: cd plugins/sip-engine && npm run build:server
 *
 * Requirements: esbuild must be available (it is a project devDependency).
 *
 * IMPORTANT: Always run this script after editing any .ts file in this plugin,
 * then commit both the .ts and the generated .js file together.
 */

import { execSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

const SERVER_FILES = [
  "plugins/sip-engine/index.ts",
  "plugins/sip-engine/service-registry.ts",
  "plugins/sip-engine/types.ts",
  "plugins/sip-engine/services/elevenlabs-sip.service.ts",
  "plugins/sip-engine/services/openai-sip.service.ts",
  "plugins/sip-engine/services/sip-trunk.service.ts",
  "plugins/sip-engine/routes/admin-sip.routes.ts",
  "plugins/sip-engine/routes/openai-sip-stream.ts",
  "plugins/sip-engine/routes/openai-sip-webhooks.routes.ts",
  "plugins/sip-engine/routes/user-phone-numbers.routes.ts",
  "plugins/sip-engine/routes/user-trunks.routes.ts",
];

const GENERATED_HEADER = `// @generated — do not edit directly. Run: node plugins/sip-engine/transpile.mjs\n`;

/**
 * Add .js extension to relative imports that are missing it.
 * Node.js ESM requires explicit extensions on relative specifiers.
 */
function fixRelativeExtensions(code) {
  return code
    .replace(/\b(from\s+)(["'])(\.\.?\/[^"']+)(["'])/g, (match, kw, q1, path, q2) => {
      if (/\.(js|json|css|ts|mjs|cjs)$/.test(path)) return match;
      return `${kw}${q1}${path}.js${q2}`;
    })
    .replace(/\bimport\((["'])(\.\.?\/[^"']+)(["'])\)/g, (match, q1, path, q2) => {
      if (/\.(js|json|css|ts|mjs|cjs)$/.test(path)) return match;
      return `import(${q1}${path}.js${q2})`;
    });
}

let changed = 0;
let unchanged = 0;
const errors = [];

for (const tsFile of SERVER_FILES) {
  const jsFile = tsFile.replace(/\.ts$/, ".js");
  const absTs = resolve(root, tsFile);
  const absJs = resolve(root, jsFile);

  try {
    const raw = execSync(
      `npx esbuild ${absTs} --format=esm --target=node18 --platform=node --bundle=false`,
      { encoding: "utf8", cwd: root }
    );

    const output = GENERATED_HEADER + fixRelativeExtensions(raw);

    let existing = "";
    try { existing = readFileSync(absJs, "utf8"); } catch {}

    if (output === existing) {
      console.log(`  unchanged  ${jsFile}`);
      unchanged++;
    } else {
      writeFileSync(absJs, output, "utf8");
      console.log(`  updated    ${jsFile}`);
      changed++;
    }
  } catch (err) {
    console.error(`  ERROR      ${tsFile}: ${err.message}`);
    errors.push(tsFile);
  }
}

console.log(`\nDone: ${changed} updated, ${unchanged} unchanged, ${errors.length} errors.`);

if (errors.length > 0) {
  console.error("Failed files:", errors);
  process.exit(1);
}

// Verify no is_primary references remain
let found = false;
for (const tsFile of SERVER_FILES) {
  const jsFile = tsFile.replace(/\.ts$/, ".js");
  const content = readFileSync(resolve(root, jsFile), "utf8");
  if (content.includes("is_primary")) {
    console.error(`SECURITY WARNING: is_primary still present in ${jsFile}`);
    found = true;
  }
}
if (!found) {
  console.log("Verified: No stale is_primary references in any generated file.");
}
