#!/usr/bin/env node
// Regenerates the MarketSDK client libraries from a released API description.
//
//   node scripts/regenerate.mjs --description 1.0.0 --sdk-version 1.0.0 [--from <file>] [--group <name>]...
//
// --description   The API description version to generate from. The released file is fetched
//                 from https://api.marketsdk.com/v1/openapi.json unless --from names a local copy.
//                 Either way the file's info.version must equal this value.
// --sdk-version   The version stamped into every generated package.
// --from          A local copy of the released description, for work before it is served.
// --group         A group from fern/generators.yml. Repeatable. Default: every group.
//
// Every run builds each library's package in the language's official Docker image. That is not
// optional: Fern writes a complete, buildable project only when asked to package it, and the build
// is the check that the generated code compiles.
//
// Each SDK repository must be checked out beside this one, under the names in fern/generators.yml.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const LEFTOVERS = [
  "fern-dist", "node_modules", "dist", "build", ".fern", ".pnpm-store", ".fern-pack-venv", ".gradle",
  "src/.php-cs-fixer.cache", "vendor", ".venv", "composer.lock", "sample-app/build", "sample-app/.gradle",
  // Fern's changelog carries the generation date, which would make two runs on the same inputs differ.
  "changelog.md",
];

// Added to each repository's .gitignore, after whatever the generator wrote.
const IGNORE = {
  typescript: ["node_modules/", "dist/", ".pnpm-store/", "fern-dist/"],
  python: ["__pycache__/", "*.pyc", ".venv/", "dist/", "build/", "*.egg-info/", ".pytest_cache/", ".mypy_cache/", "fern-dist/"],
  go: ["fern-dist/"],
  java: [".gradle/", "build/", "fern-dist/"],
  csharp: ["bin/", "obj/", "fern-dist/"],
  php: ["vendor/", "composer.lock", ".php-cs-fixer.cache", ".phpunit.result.cache", "fern-dist/"],
};

const LICENSE = `MIT License

Copyright (c) 2026 Focussoft HQ LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

// How Ausaf publishes each library, by hand, from his machine. Written into every repository.
const RELEASING = {
  typescript: `# Releasing

Publishing is by hand, from a clean clone at the tag. The version in \`package.json\` is stamped by the
generator; nothing here is edited.

One-time setup: an npm account that is a member of the \`marketsdk\` organization, with two-factor
authentication on.

\`\`\`bash
npm install -g pnpm@10
pnpm install
pnpm build
npm publish --access public
\`\`\`

Then check \`npm view @marketsdk/js version\`.
`,
  python: `# Releasing

Publishing is by hand, from a clean clone at the tag. The version in \`pyproject.toml\` is stamped by
the generator; nothing here is edited.

One-time setup: a PyPI account with two-factor authentication on. The first upload uses the account;
after it, make an API token scoped to the \`marketsdk\` project and use that.

\`\`\`bash
python3 -m venv .venv && . .venv/bin/activate
pip install build twine
python -m build
twine upload dist/*
\`\`\`

Then check \`pip index versions marketsdk\`.
`,
  go: `# Releasing

Go has no registry upload. A release is a tag on this public repository; the module proxy fetches it
on first request.

\`\`\`bash
git tag v1.0.0
git push origin v1.0.0
GOPROXY=https://proxy.golang.org go list -m github.com/focussofthq/marketsdk-go@v1.0.0
\`\`\`

The tag must be the module version with a \`v\` prefix, and the module path in \`go.mod\` must be this
repository's path, which the generator sets.
`,
  java: `# Releasing

Publishing is by hand, from a clean clone at the tag, to Maven Central through the Central Portal.
The coordinates and version in \`build.gradle\` are stamped by the generator; nothing here is edited.

One-time setup:

1. A Central Portal account at https://central.sonatype.com, with the \`com.marketsdk\` namespace
   verified by the DNS TXT record the portal asks for on marketsdk.com.
2. A GPG key whose public key is on a key server (\`gpg --keyserver keyserver.ubuntu.com --send-keys <id>\`).

Each release, build and sign locally, then upload the bundle:

\`\`\`bash
# Publish into a local directory laid out as a Maven repository.
MAVEN_PUBLISH_REGISTRY_URL=file://$PWD/staging MAVEN_USERNAME=x MAVEN_PASSWORD=x ./gradlew publish
# Sign every artifact.
cd staging && find . -type f ! -name '*.asc' ! -name '*.md5' ! -name '*.sha1' -exec gpg --armor --detach-sign {} \;
# Bundle, keeping the directory layout.
zip -r ../marketsdk-java-1.0.0-bundle.zip .
\`\`\`

Upload the bundle at https://central.sonatype.com/publishing, check the validation result, and
publish. Then check https://central.sonatype.com/artifact/com.marketsdk/marketsdk-java.
`,
  csharp: `# Releasing

Publishing is by hand, from a clean clone at the tag. The package id and version in the project file
are stamped by the generator; nothing here is edited.

One-time setup: a nuget.org account with two-factor authentication on, and an API key scoped to
pushing the \`MarketSDK\` package.

\`\`\`bash
dotnet pack src/MarketSDK/MarketSDK.csproj -c Release -o out
dotnet nuget push out/MarketSDK.1.0.0.nupkg --api-key "$NUGET_API_KEY" --source https://api.nuget.org/v3/index.json
\`\`\`

Then check https://www.nuget.org/packages/MarketSDK.
`,
  php: `# Releasing

Packagist reads this public repository. The first release is a submission; every later one is a tag.

One-time setup: a Packagist account; submit https://github.com/focussofthq/marketsdk-php at
https://packagist.org/packages/submit, which claims the \`marketsdk\` vendor; then add the Packagist
GitHub service hook so new tags are picked up.

\`\`\`bash
git tag v1.0.0
git push origin v1.0.0
\`\`\`

Then check https://packagist.org/packages/marketsdk/php.
`,
};

const contributing = (language) => `# Contributing

This library is generated from the MarketSDK API description. Nothing in this repository is
written by hand, and a pull request that edits generated code cannot be merged, because the next
regeneration would undo it.

- A problem with the API itself: email hello@marketsdk.com.
- A problem with this library (a wrong type, a method that does not work, a build failure): open an
  issue here. The fix goes into the generator configuration at
  https://github.com/focussofthq/marketsdk-sdk-generator, and every library is regenerated.
- A problem with the documentation at https://marketsdk.com/docs: email hello@marketsdk.com.

The \`GENERATED\` file says which description version and generator produced this ${language} library.
`;

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const fernDir = join(root, "fern");
const descriptionPath = join(fernDir, "openapi", "marketsdk-v1.json");
const descriptionUrl = "https://api.marketsdk.com/v1/openapi.json";

const args = parseArgs(process.argv.slice(2));
if (!args.description || !args.sdkVersion) {
  console.error("Usage: node scripts/regenerate.mjs --description <x.y.z> --sdk-version <x.y.z> [--from <file>] [--group <name>]...");
  process.exit(64);
}

const generatorsYml = readFileSync(join(fernDir, "generators.yml"), "utf8");
const groups = parseGroups(generatorsYml);
const selected = args.groups.length > 0 ? args.groups : Object.keys(groups);
for (const g of selected) {
  if (!groups[g]) {
    console.error(`No group named ${g} in fern/generators.yml. Groups: ${Object.keys(groups).join(", ")}`);
    process.exit(64);
  }
}

const cliVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).devDependencies["fern-api"];

// 1. The description.
const description = await loadDescription(args.from, args.description);
mkdirSync(dirname(descriptionPath), { recursive: true });
writeFileSync(descriptionPath, description.text);
console.log(`Description ${args.description} (${description.source}, sha256 ${description.sha256.slice(0, 12)})`);

// 2. Generate, one group at a time.
for (const name of selected) {
  const group = groups[name];
  const outputDir = resolve(fernDir, group.path);
  if (!existsSync(outputDir)) {
    console.error(`${name}: output directory ${outputDir} does not exist. Check out the SDK repository beside this one.`);
    process.exit(1);
  }
  console.log(`\n== ${name} -> ${outputDir}`);
  // Start from an empty tree so a file the generator no longer writes does not survive from the
  // previous run. Only .git is kept.
  for (const entry of readdirSync(outputDir)) {
    if (entry !== ".git") rmSync(join(outputDir, entry), { recursive: true, force: true });
  }
  // --force answers the "directory contains existing files" prompt; the repository's .git is always there.
  const fernArgs = [
    "fern", "generate", "--local", "--force", "--group", name, "--version", args.sdkVersion,
    "--package", "--package-mode", "docker", "--log-level", "warn",
  ];
  const result = spawnSync("npx", fernArgs, { cwd: root, stdio: "inherit", env: { ...process.env, FERN_TOKEN: "" } });
  if (result.status !== 0) {
    console.error(`${name}: generation failed`);
    process.exit(result.status ?? 1);
  }
  // Fern's packaging step leaves build output behind, and Fern writes its own metadata folder.
  // None of it belongs in the repository.
  for (const leftover of LEFTOVERS) {
    rmSync(join(outputDir, leftover), { recursive: true, force: true });
  }
  removeDirsNamed(outputDir, ["obj", "bin"], (p) => p.includes(`${sep}src${sep}`));
  removeFilesNamed(outputDir, [".php-cs-fixer.cache", ".DS_Store"]);
  if (name === "java") patchJavaBuildGradle(join(outputDir, "build.gradle"));
  writeFileSync(join(outputDir, "LICENSE"), LICENSE);
  writeFileSync(join(outputDir, "CONTRIBUTING.md"), contributing(name));
  writeFileSync(join(outputDir, "RELEASING.md"), RELEASING[name]);
  mergeGitignore(join(outputDir, ".gitignore"), IGNORE[name] ?? []);
  writeFileSync(
    join(outputDir, "GENERATED"),
    [
      `description-version: ${args.description}`,
      `description-sha256: ${description.sha256}`,
      `sdk-version: ${args.sdkVersion}`,
      `fern-cli: ${cliVersion}`,
      `generator: ${group.generator} ${group.version}`,
      "",
      "Generated by https://github.com/focussofthq/marketsdk-sdk-generator. Do not edit by hand.",
      "",
    ].join("\n"),
  );
}
console.log("\nDone.");

async function loadDescription(from, expectedVersion) {
  let text;
  let source;
  if (from) {
    text = readFileSync(resolve(from), "utf8");
    source = resolve(from);
  } else {
    const response = await fetch(descriptionUrl);
    if (!response.ok) throw new Error(`${descriptionUrl} answered ${response.status}`);
    text = await response.text();
    source = descriptionUrl;
  }
  const parsed = JSON.parse(text);
  if (parsed.info?.version !== expectedVersion) {
    throw new Error(`The description at ${source} is version ${parsed.info?.version}, not ${expectedVersion}.`);
  }
  // Normalise so the committed copy does not depend on how the server serialised it.
  const normalised = JSON.stringify(parsed, null, 2) + "\n";
  return { text: normalised, source, sha256: createHash("sha256").update(normalised).digest("hex") };
}

// The one correction made to generated output. Fern's Java generator fills the POM's scm block only
// when it publishes to GitHub itself, and writes the publisher's name as the POM's name. Maven
// Central requires both, so they are set here. Each replacement must find its text, so a generator
// upgrade that changes the build file is noticed rather than silently shipping a placeholder.
function patchJavaBuildGradle(path) {
  let text = readFileSync(path, "utf8");
  const replacements = [
    ["https://github.com/YOUR-ORG/YOUR-REPO", "https://github.com/focussofthq/marketsdk-java"],
    ["github.com/YOUR-ORG/YOUR-REPO.git", "github.com/focussofthq/marketsdk-java.git"],
    ["                name = 'Focussoft HQ LLC'\n                description =", "                name = 'marketsdk-java'\n                description ="],
  ];
  for (const [from, to] of replacements) {
    if (!text.includes(from)) throw new Error(`java: build.gradle no longer contains "${from}". Check the generator's POM output and update patchJavaBuildGradle.`);
    text = text.split(from).join(to);
  }
  writeFileSync(path, text);
}

function removeDirsNamed(dir, names, where) {
  for (const entry of readdirSync(dir)) {
    if (entry === ".git") continue;
    const p = join(dir, entry);
    if (!statSync(p).isDirectory()) continue;
    if (names.includes(entry) && where(p + sep)) rmSync(p, { recursive: true, force: true });
    else removeDirsNamed(p, names, where);
  }
}

function removeFilesNamed(dir, names) {
  for (const entry of readdirSync(dir)) {
    if (entry === ".git") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) removeFilesNamed(p, names);
    else if (names.includes(entry)) rmSync(p, { force: true });
  }
}

function mergeGitignore(path, lines) {
  const marker = "# Build output. Added by marketsdk-sdk-generator.";
  let existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const cut = existing.indexOf(marker);
  if (cut >= 0) existing = existing.slice(0, cut);
  existing = existing.replace(/\s+$/, "");
  const have = new Set(existing.split("\n").map((l) => l.trim()));
  const add = lines.filter((l) => !have.has(l));
  const body = (existing ? existing + "\n\n" : "") + marker + "\n" + add.join("\n") + "\n";
  writeFileSync(path, body);
}

// A minimal reader for the parts of generators.yml this script needs: group name, generator name and
// version, and the local output path. It expects the file's indentation as committed.
function parseGroups(yml) {
  const groups = {};
  let current = null;
  let inGroups = false;
  for (const line of yml.split("\n")) {
    if (/^groups:\s*$/.test(line)) { inGroups = true; continue; }
    if (!inGroups) continue;
    let m;
    if ((m = /^  ([a-z0-9-]+):\s*$/.exec(line))) { current = groups[m[1]] = {}; continue; }
    if (!current) continue;
    if ((m = /^\s+- name:\s*(\S+)/.exec(line))) current.generator = m[1];
    else if ((m = /^\s+version:\s*(\S+)/.exec(line)) && !current.version) current.version = m[1];
    else if ((m = /^\s+path:\s*(\S+)/.exec(line))) current.path = m[1];
  }
  return groups;
}

function parseArgs(argv) {
  const out = { groups: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--description") out.description = argv[++i];
    else if (a === "--sdk-version") out.sdkVersion = argv[++i];
    else if (a === "--from") out.from = argv[++i];
    else if (a === "--group") out.groups.push(argv[++i]);
    else { console.error(`Unknown argument ${a}`); process.exit(64); }
  }
  return out;
}
