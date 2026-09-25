// End-to-end check: real MCP client -> Streamable HTTP -> CareLoop tools.
process.env.NODE_ENV = "test";
process.env.CARELOOP_DATA = "data/smoke.json";
process.env.CARELOOP_TZ = "UTC";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const store = await import("../src/store.js");
const { app } = await import("../src/server.js");

// Slot picking with a fixed clock: catch up on the earliest overdue dose first.
{
  const asha = (await store.load()).people[0];
  const night = new Date("2026-09-25T21:00:00Z");
  assert.equal(store.pickSlot(asha, "metformin", night), "08:00");
  asha.medLogs.push({ medicationId: "metformin", scheduledTime: "08:00", date: store.dateKey(night), taken: true, at: "" });
  assert.equal(store.pickSlot(asha, "metformin", night), "20:00");
  assert.equal(store.pickSlot(asha, "metformin", new Date("2026-09-25T06:00:00Z")), "20:00"); // only upcoming left
}

const http = app.listen(0);
const port = (http.address() as { port: number }).port;
const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`)));

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
assert.deepEqual(tools, [
  "daily_summary", "flag_concern", "get_care_schedule", "get_missed_doses", "list_people", "log_medication", "record_checkin",
]);

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { isError: r.isError, text: (r.content as { text: string }[])[0].text };
};

assert.ok((await call("list_people")).text.includes("Ravi"));
const sched = (await call("get_care_schedule")).text;
assert.ok(sched.includes("Asha: ") && sched.includes("Ravi: "));

// The person is inferred when the medication belongs to only one of them.
assert.ok((await call("log_medication", { medication: "vitamin" })).text.includes("Asha's Vitamin D"));
assert.ok((await call("log_medication", { medication: "amlodipine" })).text.includes("Ravi's Amlodipine"));
assert.ok((await call("log_medication", { medication: "metformin", person: "mom", taken: false })).text.includes("skipped"));
assert.equal((await call("log_medication", { medication: "metformin", person: "dad" })).isError, true);
assert.equal((await call("log_medication", { medication: "aspirin" })).isError, true);

// Ambiguous requests ask whom; named ones notify that person's caregivers only.
const ambiguous = await call("record_checkin", { mood: 1 });
assert.equal(ambiguous.isError, true);
assert.ok(ambiguous.text.startsWith("Whom do you mean"));
assert.ok((await call("record_checkin", { mood: 1, note: "dizzy", person: "dad" })).text.includes("Ravi's mood"));
assert.ok((await call("flag_concern", { message: "Skipped lunch", person: "Asha" })).text.includes("Asha's concern"));

const state = store.dashboardState(await store.load());
assert.equal(state.people.find((p) => p.name === "Ravi")!.concerns.length, 1);
assert.equal(state.people.find((p) => p.name === "Asha")!.concerns.length, 1);

const summary = (await call("daily_summary")).text;
assert.ok(summary.includes("Asha") && summary.includes("Ravi"));
console.log("summary:", summary);

await client.close();
http.close();
rmSync("data/smoke.json", { force: true });
console.log("smoke OK");
