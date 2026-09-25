import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildDigest } from "./digest.js";
import {
  dateKey, findMedication, load, pickSlot, resolveForMedication, resolvePerson, save, todaysDoses,
  type Person, type Resolved,
} from "./store.js";

const text = (t: string, structured?: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text: t }],
  ...(structured ? { structuredContent: structured } : {}),
});

const fail = (t: string) => ({ ...text(t), isError: true });

const personArg = z
  .string()
  .optional()
  .describe("Who this is about, e.g. 'mom', 'dad' or a name. Optional when only one person is in the care circle.");

/** People a read-only tool should cover: the named person, or everyone when none is named. */
async function scope(personQuery?: string): Promise<{ people: Person[] } | { error: string }> {
  const db = await load();
  if (!personQuery) return { people: db.people };
  const r = resolvePerson(db, personQuery);
  return "error" in r ? r : { people: [r.person] };
}

const prefix = (people: Person[], p: Person) => (people.length > 1 ? `${p.name}: ` : "");

export function createServer(): McpServer {
  const server = new McpServer({ name: "careloop", version: "0.2.0" });

  server.registerTool(
    "list_people",
    {
      title: "List people",
      description: "The people in the care circle and their caregivers. Use this to resolve who the user means.",
      inputSchema: {},
    },
    async () => {
      const { people } = await load();
      const list = people.map((p) => ({ id: p.id, name: p.name, relation: p.relation, caregivers: p.caregivers }));
      return text(`I look after ${people.map((p) => `${p.name} (${p.relation})`).join(" and ")}.`, { people: list });
    },
  );

  server.registerTool(
    "get_care_schedule",
    {
      title: "Get care schedule",
      description: "Today's medication schedule with each dose's status. Covers everyone if no person is named.",
      inputSchema: { person: personArg },
    },
    async ({ person }) => {
      const s = await scope(person);
      if ("error" in s) return fail(s.error);
      const schedule = s.people.map((p) => ({ person: p.name, doses: todaysDoses(p) }));
      const lines = s.people.flatMap((p) =>
        todaysDoses(p).map((d) => `${prefix(s.people, p)}${d.time} ${d.name} ${d.dose}: ${d.status}`),
      );
      return text(`Today's schedule:\n${lines.join("\n")}`, { schedule });
    },
  );

  server.registerTool(
    "log_medication",
    {
      title: "Log medication",
      description:
        "Record that a medication was taken (or skipped). Catches up the earliest overdue dose first, " +
        "unless a slot time is given. The person can be inferred from the medication name when it is unique.",
      inputSchema: {
        medication: z.string().describe("Medication name, e.g. 'metformin'"),
        person: personArg,
        taken: z.boolean().default(true).describe("false if the dose was skipped"),
        scheduledTime: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("Slot as HH:MM"),
        note: z.string().max(200).optional(),
      },
    },
    async ({ medication, person, taken, scheduledTime, note }) => {
      const db = await load();
      const r: Resolved = resolveForMedication(db, medication, person);
      if ("error" in r) return fail(r.error);
      const p = r.person;
      const med = findMedication(p, medication);
      if (!med) return fail(`${p.name} doesn't take "${medication}".`);
      const slot = scheduledTime ?? pickSlot(p, med.id);
      if (!slot || !med.times.includes(slot)) return fail(`No open ${med.name} dose for ${p.name} right now.`);
      p.medLogs.push({
        medicationId: med.id, scheduledTime: slot, date: dateKey(), taken, note, at: new Date().toISOString(),
      });
      await save(db);
      return text(`Logged ${p.name}'s ${med.name} ${med.dose} for the ${slot} slot as ${taken ? "taken" : "skipped"}.`, {
        person: p.id, medication: med.id, slot, taken,
      });
    },
  );

  server.registerTool(
    "get_missed_doses",
    {
      title: "Get missed doses",
      description: "Doses today that are past their grace window with nothing logged. Covers everyone if no person is named.",
      inputSchema: { person: personArg },
    },
    async ({ person }) => {
      const s = await scope(person);
      if ("error" in s) return fail(s.error);
      const missed = s.people.flatMap((p) =>
        todaysDoses(p).filter((d) => d.status === "missed").map((d) => ({ person: p.name, ...d })),
      );
      if (!missed.length) return text("No missed doses today.", { missed });
      return text(`Missed today: ${missed.map((m) => `${m.person}'s ${m.name} at ${m.time}`).join(", ")}.`, { missed });
    },
  );

  server.registerTool(
    "record_checkin",
    {
      title: "Record check-in",
      description: "Record how a person is feeling today. Low moods automatically notify their caregivers.",
      inputSchema: {
        person: personArg,
        mood: z.number().int().min(1).max(5).describe("1 (very poor) to 5 (great)"),
        note: z.string().max(300).optional(),
      },
    },
    async ({ person, mood, note }) => {
      const db = await load();
      const r = resolvePerson(db, person);
      if ("error" in r) return fail(r.error);
      const p = r.person;
      p.checkins.push({ date: dateKey(), mood, note, at: new Date().toISOString() });
      let extra = "";
      if (mood <= 2) {
        p.concerns.push({
          id: `${p.id}-c${p.concerns.length + 1}`,
          severity: mood === 1 ? "high" : "medium",
          message: `Low mood (${mood}/5) at check-in${note ? `: ${note}` : ""}`,
          notified: p.caregivers,
          at: new Date().toISOString(),
        });
        extra = ` I've let ${p.caregivers.join(" and ")} know.`;
      }
      await save(db);
      return text(`Thanks, I've noted ${p.name}'s mood as ${mood} out of 5.${extra}`, { person: p.id, mood });
    },
  );

  server.registerTool(
    "flag_concern",
    {
      title: "Flag a concern",
      description: "Raise a concern about a person's wellbeing and notify their family caregivers.",
      inputSchema: {
        person: personArg,
        message: z.string().min(3).max(300),
        severity: z.enum(["low", "medium", "high"]).default("medium"),
      },
    },
    async ({ person, message, severity }) => {
      const db = await load();
      const r = resolvePerson(db, person);
      if ("error" in r) return fail(r.error);
      const p = r.person;
      p.concerns.push({
        id: `${p.id}-c${p.concerns.length + 1}`, severity, message, notified: p.caregivers, at: new Date().toISOString(),
      });
      await save(db);
      return text(`Flagged ${p.name}'s concern as ${severity}. Notified ${p.caregivers.join(" and ")}.`, {
        person: p.id, severity,
      });
    },
  );

  server.registerTool(
    "daily_summary",
    {
      title: "Daily summary",
      description: "A plain-language digest of today's medications, check-ins and concerns. Covers everyone if no person is named.",
      inputSchema: { person: personArg },
    },
    async ({ person }) => {
      const s = await scope(person);
      if ("error" in s) return fail(s.error);
      const today = dateKey();
      const summaries = await Promise.all(
        s.people.map(async (p) => {
          const input = {
            person: p.name,
            doses: todaysDoses(p).map(({ name, time, status }) => ({ name, time, status })),
            checkins: p.checkins.filter((c) => c.date === today).map(({ mood, note }) => ({ mood, note })),
            concerns: p.concerns
              .filter((c) => dateKey(new Date(c.at)) === today)
              .map(({ severity, message }) => ({ severity, message })),
          };
          const { text: digest, source } = await buildDigest(input);
          return { person: p.name, digest, source };
        }),
      );
      return text(summaries.map((x) => x.digest).join(" "), { summaries });
    },
  );

  return server;
}
