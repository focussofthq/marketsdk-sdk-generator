#!/usr/bin/env node
// A stand-in for api.marketsdk.com that answers GET /v1/sellers/{id} with a real seller object,
// taken from the backend, carrying a field and an enum value the description does not know. Each
// smoke test points its client at this server once, to prove the client passes both through
// instead of failing.
//
//   node smoke/mock-server.mjs <port> <seller.json>
//
// Prints "listening <port>" once it is ready.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const [portArg, sellerFile] = process.argv.slice(2);
const port = Number(portArg ?? 0);
const seller = JSON.parse(readFileSync(sellerFile, "utf8"));
seller.status = "hibernating"; // Not a value the description knows.
seller.surprise_field = { nested: true }; // Fields no version of the description has.
seller.another_new_number = 42;

const server = createServer((req, res) => {
  if (req.method === "GET" && /^\/v1\/sellers\/[^/]+$/.test(req.url ?? "")) {
    res.writeHead(200, { "Content-Type": "application/json", "X-Request-Id": "req_mock" });
    res.end(JSON.stringify({ ...seller, id: decodeURIComponent(req.url.split("/").pop()) }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { code: "not_found", message: "Mock server: not found", request_id: "req_mock" } }));
});
server.listen(port, "0.0.0.0", () => {
  console.log(`listening ${server.address().port}`);
});
