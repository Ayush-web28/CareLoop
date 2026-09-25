// Invokes the esbuild bundle (dist/lambda.mjs) with Lambda Function URL events.
process.env.CARELOOP_DATA = "data/smoke-lambda.json";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const { handler } = await import("../dist/lambda.mjs" as string);

const ev = (method: string, path: string, body?: unknown) => ({
  rawPath: path,
  rawQueryString: "",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  requestContext: { domainName: "abc.lambda-url.us-east-1.on.aws", http: { method } },
  body: body === undefined ? undefined : JSON.stringify(body),
  isBase64Encoded: false,
});
const rpc = (id: number, method: string, params: object = {}) => ev("POST", "/mcp", { jsonrpc: "2.0", id, method, params });

let r = await handler(ev("GET", "/"));
assert.equal(r.statusCode, 200);
assert.ok(r.body.includes("CareLoop"));

r = await handler(rpc(1, "tools/list"));
assert.equal(r.statusCode, 200);
assert.equal(JSON.parse(r.body).result.tools.length, 6);

r = await handler(rpc(2, "tools/call", { name: "log_medication", arguments: { medication: "vitamin" } }));
assert.ok(JSON.parse(r.body).result.content[0].text.includes("Vitamin D"));

r = await handler(ev("GET", "/api/state"));
assert.ok(JSON.parse(r.body).doses.some((d: { name: string; status: string }) => d.name === "Vitamin D" && d.status === "taken"));

assert.equal((await handler(ev("GET", "/mcp"))).statusCode, 405);
assert.equal((await handler(ev("GET", "/nope"))).statusCode, 404);

rmSync("data/smoke-lambda.json", { force: true });
console.log("lambda smoke OK");
