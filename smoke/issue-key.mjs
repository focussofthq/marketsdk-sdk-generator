#!/usr/bin/env node
// Signs in to a local MarketSDK backend the way a person does, makes a workspace, and prints a
// test-mode secret key. For the smoke tests only; it needs the backend running with
// EMAIL_DRIVER=log so the sign-in code can be read from its log.
//
//   node smoke/issue-key.mjs <backend log file>
//
// Environment: MARKETSDK_BACKEND_URL (default http://127.0.0.1:3001), DASHBOARD_PROXY_SECRET
// (default development-only-proxy-secret), NEXT_PUBLIC_SITE_URL (default http://localhost:3000).

import { readFileSync } from "node:fs";

const backend = (process.env.MARKETSDK_BACKEND_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const secret = process.env.DASHBOARD_PROXY_SECRET ?? "development-only-proxy-secret";
const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").origin;
const [logFile] = process.argv.slice(2);
if (!logFile) {
  console.error("Usage: node smoke/issue-key.mjs <backend log file>");
  process.exit(64);
}

let cookie = "";
async function dashboard(method, path, body) {
  const response = await fetch(`${backend}/dashboard${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Dashboard-Proxy": secret,
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = response.headers.getSetCookie();
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} /dashboard${path}: ${response.status} ${JSON.stringify(json)}`);
  return json;
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const email = `sdk-smoke-${Date.now()}@example.com`;
await dashboard("POST", "/auth/sign-in", { email });
let code;
for (let i = 0; i < 40 && !code; i++) {
  await pause(250);
  const log = readFileSync(logFile, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
  code = [...log.matchAll(/To: (\S+)\. Subject: Your MarketSDK sign-in code\n[\s\S]*?\n(\d{6})\n/g)]
    .filter((m) => m[1] === email)
    .at(-1)?.[2];
}
if (!code) throw new Error(`No sign-in code for ${email} in ${logFile}. Is the backend running with EMAIL_DRIVER=log?`);
await dashboard("POST", "/auth/sign-in/code", { email, code });
await dashboard("PATCH", "/workspace", { name: "SDK smoke test" });
await dashboard("PATCH", "/test/settings", { payments: false, seller_verification: false });
const created = await dashboard("POST", "/test/api-keys", { name: "smoke", kind: "secret" });
process.stdout.write(created.key + "\n");
