// End-to-end check: real MCP client -> Streamable HTTP -> CareLoop tools.
process.env.NODE_ENV = "test";
process.env.CARELOOP_DATA = "data/smoke.json";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const { app } = await import("../src/server.js");
const http = app.listen(0);
const port = (http.address() as { port: number }).port;

const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`)));

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
assert.deepEqual(tools, [
  "daily_summary", "flag_concern", "get_care_schedule", "get_missed_doses", "log_medication", "record_checkin",
]);

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { isError: r.isError, text: (r.content as { text: string }[])[0].text };
};

assert.ok((await call("get_care_schedule")).text.includes("Metformin"));
assert.ok((await call("log_medication", { medication: "vitamin" })).text.includes("Vitamin D"));
assert.equal((await call("log_medication", { medication: "aspirin" })).isError, true);
assert.ok((await call("record_checkin", { mood: 1, note: "dizzy" })).text.includes("let"));
assert.ok((await call("flag_concern", { message: "Skipped lunch" })).text.includes("Notified"));
console.log("summary:", (await call("daily_summary")).text);

await client.close();
http.close();
rmSync("data/smoke.json", { force: true });
console.log("smoke OK");
