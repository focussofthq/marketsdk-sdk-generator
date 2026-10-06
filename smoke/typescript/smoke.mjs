// Smoke test for @marketsdk/js. See smoke/run.mjs for what every test does.
import { MarketSDK, MarketSDKError } from "@marketsdk/js";

const key = process.env.MARKETSDK_KEY;
const baseUrl = process.env.MARKETSDK_BASE_URL;
const mockUrl = process.env.MARKETSDK_MOCK_URL;
if (!key || !baseUrl || !mockUrl) throw new Error("MARKETSDK_KEY, MARKETSDK_BASE_URL, and MARKETSDK_MOCK_URL are required");

const assert = (cond, what) => { if (!cond) throw new Error(`failed: ${what}`); };

const client = new MarketSDK({ token: key, baseUrl });
const externalId = `smoke-ts-${Date.now()}`;
const idempotencyKey = `smoke-ts-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Create, then replay with the same Idempotency-Key.
const created = await client.sellers.createSeller({ external_id: externalId }, { headers: { "Idempotency-Key": idempotencyKey } });
assert(created.id.startsWith("sel_"), "created seller has an id");
assert(created.external_id === externalId, "created seller carries external_id");
const replayed = await client.sellers.createSeller({ external_id: externalId }, { headers: { "Idempotency-Key": idempotencyKey } });
assert(replayed.id === created.id, "replay returns the same seller");

// List with a limit, then read back.
const page = await client.sellers.listSellers({ limit: 2 });
assert(Array.isArray(page.data) && page.data.length <= 2, "list honours limit");
assert(typeof page.has_more === "boolean", "list has has_more");
const fetched = await client.sellers.getSeller({ id: created.id });
assert(fetched.id === created.id, "get returns the seller");

// A bad request is a typed error carrying the envelope.
let caught;
try {
  await client.sellers.createSeller({ external_id: "x".repeat(201) });
} catch (e) {
  caught = e;
}
assert(caught instanceof MarketSDKError, "bad request raises MarketSDKError");
assert(caught.statusCode === 400, `bad request status is 400 (got ${caught?.statusCode})`);
assert(typeof caught.body?.error?.code === "string" && caught.body.error.code.length > 0, "error has code");
assert(typeof caught.body?.error?.request_id === "string" && caught.body.error.request_id.length > 0, "error has request_id");

// Unknown field and unknown enum value pass through.
const mock = new MarketSDK({ token: key, baseUrl: mockUrl });
const odd = await mock.sellers.getSeller({ id: "sel_mock000000000000000000" });
assert(odd.status === "hibernating", `unknown enum value passes through (got ${odd.status})`);
assert(odd.id === "sel_mock000000000000000000", "mock seller parsed");

console.log("ok");
