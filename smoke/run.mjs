#!/usr/bin/env node
// Runs the smoke test of each library against a local MarketSDK backend in test mode.
//
//   node smoke/run.mjs <backend log file> [language...]
//
// Languages: typescript python go java csharp php. Default: all six.
//
// Needs the backend running on 127.0.0.1:3001 with EMAIL_DRIVER=log, and, because Java, C#, and PHP
// run inside Docker, with host.docker.internal in MARKETSDK_API_HOSTS. Node, Python 3.10+, and Go
// run on this machine. Each SDK repository must be checked out beside this one.
//
// Every test does the same things, in its own language: creates a seller with an Idempotency-Key,
// repeats the call and expects the same seller back, lists sellers with a limit, reads the seller
// by id, sends an invalid request and expects a typed error with the envelope's code and
// request_id, then reads a seller from the mock server and expects an unknown field and an unknown
// enum value to pass through. It prints "ok" on success and exits non-zero otherwise.
//
// Environment: MARKETSDK_KEY skips issuing a key.

import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const sdks = resolve(root, "..");
const [logFile, ...requested] = process.argv.slice(2);
if (!logFile) {
  console.error("Usage: node smoke/run.mjs <backend log file> [language...]");
  process.exit(64);
}
const all = ["typescript", "python", "go", "java", "csharp", "php"];
const languages = requested.length ? requested : all;
for (const l of languages) if (!all.includes(l)) { console.error(`Unknown language ${l}`); process.exit(64); }

const hostBase = "http://127.0.0.1:3001";
const dockerBase = "http://host.docker.internal:3001";

// A key for the test workspace.
let key = process.env.MARKETSDK_KEY;
if (!key) {
  const issued = spawnSync("node", [join(here, "issue-key.mjs"), logFile], { encoding: "utf8" });
  if (issued.status !== 0) { console.error(issued.stderr || issued.stdout); process.exit(1); }
  key = issued.stdout.trim();
}

// A real seller from the backend, which the mock server serves with an unknown field and an
// unknown enum value added.
const sellerFile = join(mkdtempSync(join(tmpdir(), "marketsdk-smoke-")), "seller.json");
{
  const response = await fetch(`${hostBase}/v1/sellers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ external_id: `smoke-mock-${Date.now()}` }),
  });
  if (!response.ok) { console.error(`Could not create the mock's seller: ${response.status} ${await response.text()}`); process.exit(1); }
  writeFileSync(sellerFile, await response.text());
}

// The mock server, for the unknown field and enum value.
const mock = spawn("node", [join(here, "mock-server.mjs"), "0", sellerFile], { stdio: ["ignore", "pipe", "inherit"] });
const mockPort = await new Promise((resolveMock) => {
  mock.stdout.on("data", (d) => { const m = /listening (\d+)/.exec(String(d)); if (m) resolveMock(m[1]); });
});

let failed = false;
try {
  for (const language of languages) {
    console.log(`\n== ${language}`);
    const ok = await run(language);
    console.log(ok ? `${language}: ok` : `${language}: FAILED`);
    if (!ok) failed = true;
  }
} finally {
  mock.kill();
  rmSync(dirname(sellerFile), { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);

async function run(language) {
  const dir = join(here, language);
  const envHost = { ...process.env, MARKETSDK_KEY: key, MARKETSDK_BASE_URL: hostBase, MARKETSDK_MOCK_URL: `http://127.0.0.1:${mockPort}` };
  const envDocker = `-e MARKETSDK_KEY=${key} -e MARKETSDK_BASE_URL=${dockerBase} -e MARKETSDK_MOCK_URL=http://host.docker.internal:${mockPort}`;
  switch (language) {
    case "typescript": {
      // The repository holds source only; build it in a scratch copy and install the tarball.
      const scratch = mkdtempSync(join(tmpdir(), "marketsdk-ts-"));
      try {
        cpSync(join(sdks, "marketsdk-typescript"), scratch, { recursive: true, filter: (p) => !p.includes("/.git") });
        if (!sh("npx", ["--yes", "pnpm@10", "install", "--frozen-lockfile=false"], { cwd: scratch })) return false;
        if (!sh("npx", ["--yes", "pnpm@10", "run", "build"], { cwd: scratch })) return false;
        if (!sh("npm", ["pack", "--pack-destination", dir, "--quiet"], { cwd: scratch })) return false;
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
      if (!sh("npm", ["install", "--no-audit", "--no-fund", "--no-save", "./marketsdk-js-1.0.0.tgz"], { cwd: dir })) return false;
      return sh("node", ["smoke.mjs"], { cwd: dir, env: envHost });
    }
    case "python": {
      const venv = join(dir, ".venv");
      rmSync(venv, { recursive: true, force: true });
      if (!sh("python3", ["-m", "venv", venv], { cwd: dir })) return false;
      const py = join(venv, "bin", "python");
      if (!sh(py, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", join(sdks, "marketsdk-python")], { cwd: dir })) return false;
      return sh(py, ["smoke.py"], { cwd: dir, env: envHost });
    }
    case "go":
      if (!sh("go", ["mod", "tidy"], { cwd: dir })) return false;
      return sh("go", ["run", "."], { cwd: dir, env: envHost });
    case "java":
      return docker(language, "gradle:8-jdk17", `${envDocker} -v ${join(sdks, "marketsdk-java")}:/sdk -w /work gradle:8-jdk17 gradle --quiet --no-daemon run`);
    case "csharp":
      return docker(language, "mcr.microsoft.com/dotnet/sdk:9.0", `${envDocker} -v ${join(sdks, "marketsdk-csharp")}:/sdk -w /work mcr.microsoft.com/dotnet/sdk:9.0 dotnet run --verbosity quiet`);
    case "php":
      return docker(language, "composer:2", `${envDocker} -v ${join(sdks, "marketsdk-php")}:/sdk -w /work composer:2 sh -c "composer install --quiet --no-interaction && php smoke.php"`);
  }
}

// The Java, C#, and PHP tests build the SDK inside its mounted repository. Nothing they leave
// behind belongs there.
function cleanSdk(language) {
  const repo = join(sdks, `marketsdk-${language === "csharp" ? "csharp" : language}`);
  const gone = { java: ["build", ".gradle", "sample-app/build", "sample-app/.gradle"], csharp: ["src/MarketSDK/bin", "src/MarketSDK/obj", "src/MarketSDK.Test/bin", "src/MarketSDK.Test/obj"], php: ["vendor", "composer.lock"] }[language] ?? [];
  for (const g of gone) rmSync(join(repo, g), { recursive: true, force: true });
}

function docker(language, image, rest) {
  const dir = join(here, language);
  const args = ["run", "--rm", "-v", `${dir}:/work`, ...rest.split(" ").filter(Boolean)];
  // Quoted shell command for PHP: rejoin after the image name.
  const shIndex = args.indexOf("sh");
  if (shIndex >= 0) {
    const cmd = args.slice(shIndex + 2).join(" ").replace(/^"|"$/g, "");
    args.splice(shIndex + 2, args.length, cmd);
  }
  try {
    return sh("docker", args, {});
  } finally {
    cleanSdk(language);
  }
}

function sh(cmd, args, { cwd, env }) {
  const r = spawnSync(cmd, args, { cwd, env: env ?? process.env, stdio: "inherit" });
  return r.status === 0;
}
