#!/usr/bin/env node
// Checks the public surface of every generated SDK against the API description, and against the
// surface recorded at the previous release.
//
//   node scripts/check-surface.mjs            compare, fail on any method missing or renamed
//   node scripts/check-surface.mjs --write    record the current surface in surface/<language>.txt
//
// The description's operationIds are the method names. Each language spells them in its own
// casing. A method in the description that no SDK method matches, or an SDK method that was in
// surface/<language>.txt and is gone, fails the check: the first is a generator defect, the second
// is a breaking change that needs a major version (see the README).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const surfaceDir = join(root, "surface");
const write = process.argv.includes("--write");

const description = JSON.parse(readFileSync(join(root, "fern", "openapi", "marketsdk-v1.json"), "utf8"));
const operationIds = [];
for (const methods of Object.values(description.paths)) {
  for (const op of Object.values(methods)) {
    if (op && typeof op === "object" && op.operationId) operationIds.push(op.operationId);
  }
}
operationIds.sort();

const languages = {
  typescript: {
    repo: "marketsdk-typescript",
    spell: camel,
    methods: () => collect("marketsdk-typescript/src/api/resources", /\/client\/Client\.ts$/, /^\s+public (\w+)\(/gm),
  },
  python: {
    repo: "marketsdk-python",
    spell: snake,
    methods: () => collect("marketsdk-python/src/marketsdk", /\/client\.py$/, /^\s+(?:async )?def ([a-z]\w*)\(/gm),
  },
  go: {
    repo: "marketsdk-go",
    spell: pascal,
    methods: () => collect("marketsdk-go", /\/client\.go$/, /^func \(c \*Client\) ([A-Z]\w*)\(/gm),
  },
  java: {
    repo: "marketsdk-java",
    spell: camel,
    methods: () => collect("marketsdk-java/src/main/java/com/marketsdk/resources", /Client\.java$/, /^\s+public [\w<>, ?]+ ([a-z]\w*)\(/gm),
  },
  csharp: {
    repo: "marketsdk-csharp",
    spell: (id) => pascal(id) + "Async",
    methods: () => collect("marketsdk-csharp/src/MarketSDK", /Client\.cs$/, /^\s+public [\w<>., ?]+ ([A-Z]\w*Async)\(/gm),
  },
  php: {
    repo: "marketsdk-php",
    spell: camel,
    methods: () => collect("marketsdk-php/src", /Client\.php$/, /^\s+public function ([a-z]\w*)\(/gm),
  },
};

let failed = false;
for (const [language, def] of Object.entries(languages)) {
  const repoDir = resolve(root, "..", def.repo);
  if (!existsSync(repoDir)) {
    console.error(`${language}: ${repoDir} is not checked out`);
    failed = true;
    continue;
  }
  const found = new Set(def.methods());
  const expected = operationIds.map(def.spell);
  const missing = expected.filter((m) => !found.has(m));
  const surface = expected.filter((m) => found.has(m)).sort();

  const file = join(surfaceDir, `${language}.txt`);
  const previous = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : null;
  const removed = previous ? previous.filter((m) => !found.has(m)) : [];
  const added = previous ? surface.filter((m) => !previous.includes(m)) : surface;

  const status = missing.length === 0 && removed.length === 0 ? "ok" : "FAIL";
  console.log(`${language.padEnd(10)} ${status}  ${surface.length}/${expected.length} methods${previous ? `, ${added.length} new, ${removed.length} removed` : ", no previous surface"}`);
  for (const m of missing) console.log(`    missing from the SDK: ${m}`);
  for (const m of removed) console.log(`    removed since the last release (breaking): ${m}`);
  if (status === "FAIL") failed = true;

  if (write) {
    mkdirSync(surfaceDir, { recursive: true });
    writeFileSync(file, surface.join("\n") + "\n");
  }
}

if (failed) process.exit(1);

function collect(dir, fileMatch, pattern) {
  const abs = resolve(root, "..", dir);
  const names = [];
  for (const file of walk(abs)) {
    if (!fileMatch.test(file)) continue;
    // Generated client files, never the raw clients, test files, or sample apps.
    if (/raw_client|RawClient|Raw\.|\/tests?\/|sample-app|_test\./.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(pattern)) names.push(m[1]);
  }
  return names;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "vendor") continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function words(id) {
  return id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").toLowerCase().split(" ");
}
function camel(id) {
  const w = words(id);
  return w[0] + w.slice(1).map(cap).join("");
}
function pascal(id) {
  return words(id).map(cap).join("");
}
function snake(id) {
  return words(id).join("_");
}
function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
