import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildDigest } from "./digest.js";
import { dateKey, findMedication, load, pickSlot, save, todaysDoses } from "./store.js";

const text = (t: string, structured?: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text: t }],
  ...(structured ? { structuredContent: structured } : {}),
});

const fail = (t: string) => ({ ...text(t), isError: true });

export function createServer(): McpServer {
  const server = new McpServer({ name: "careloop", version: "0.1.0" });

  server.registerTool(
    "get_care_schedule",
    {
      title: "Get care schedule",
      description: "Today's medication schedule for the person being cared for, with each dose's status.",
      inputSchema: {},
    },
    async () => {
      const db = await load();
      const { person } = db;
      const doses = todaysDoses(db);
      const lines = doses.map((d) => `${d.time} ${d.name} ${d.dose}: ${d.status}`);
      return text(`Schedule for ${person.name} today:\n${lines.join("\n")}`, { doses });
    },
  );

  server.registerTool(
    "log_medication",
    {
      title: "Log medication",
      description:
        "Record that a medication was taken (or skipped). Picks the scheduled slot closest to now unless a time is given.",
      inputSchema: {
        medication: z.string().describe("Medication name, e.g. 'metformin'"),
        taken: z.boolean().default(true).describe("false if the dose was skipped"),
        scheduledTime: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("Slot as HH:MM"),
        note: z.string().max(200).optional(),
      },
    },
    async ({ medication, taken, scheduledTime, note }) => {
      const db = await load();
      const med = findMedication(db, medication);
      if (!med) return fail(`I don't have a medication called "${medication}".`);
      const slot = scheduledTime ?? pickSlot(db, med.id);
      if (!slot || !med.times.includes(slot)) {
        return fail(`No open ${med.name} dose to log right now.`);
      }
      db.medLogs.push({
        medicationId: med.id,
        scheduledTime: slot,
        date: dateKey(),
        taken,
        note,
        at: new Date().toISOString(),
      });
      await save(db);
      return text(`Logged ${med.name} ${med.dose} for the ${slot} slot as ${taken ? "taken" : "skipped"}.`, {
        medication: med.id,
        slot,
        taken,
      });
    },
  );

  server.registerTool(
    "get_missed_doses",
    {
      title: "Get missed doses",
      description: "Doses today that are past their grace window with nothing logged.",
      inputSchema: {},
    },
    async () => {
      const missed = todaysDoses(await load()).filter((d) => d.status === "missed");
      if (!missed.length) return text("No missed doses today.", { missed });
      return text(`Missed today: ${missed.map((m) => `${m.name} at ${m.time}`).join(", ")}.`, { missed });
    },
  );

  server.registerTool(
    "record_checkin",
    {
      title: "Record check-in",
      description: "Record how the person is feeling today. Low moods automatically notify caregivers.",
      inputSchema: {
        mood: z.number().int().min(1).max(5).describe("1 (very poor) to 5 (great)"),
        note: z.string().max(300).optional(),
      },
    },
    async ({ mood, note }) => {
      const db = await load();
      db.checkins.push({ date: dateKey(), mood, note, at: new Date().toISOString() });
      let extra = "";
      if (mood <= 2) {
        db.concerns.push({
          id: `c${db.concerns.length + 1}`,
          severity: mood === 1 ? "high" : "medium",
          message: `Low mood (${mood}/5) at check-in${note ? `: ${note}` : ""}`,
          notified: db.person.caregivers,
          at: new Date().toISOString(),
        });
        extra = ` I've let ${db.person.caregivers.join(" and ")} know.`;
      }
      await save(db);
      return text(`Thanks, I've noted mood ${mood} out of 5.${extra}`, { mood });
    },
  );

  server.registerTool(
    "flag_concern",
    {
      title: "Flag a concern",
      description: "Raise a concern about the person's wellbeing and notify family caregivers.",
      inputSchema: {
        message: z.string().min(3).max(300),
        severity: z.enum(["low", "medium", "high"]).default("medium"),
      },
    },
    async ({ message, severity }) => {
      const db = await load();
      db.concerns.push({
        id: `c${db.concerns.length + 1}`,
        severity,
        message,
        notified: db.person.caregivers,
        at: new Date().toISOString(),
      });
      await save(db);
      return text(`Flagged as ${severity}. Notified ${db.person.caregivers.join(" and ")}.`, { severity });
    },
  );

  server.registerTool(
    "daily_summary",
    {
      title: "Daily summary",
      description: "A plain-language digest of today's medications, check-ins and concerns for family.",
      inputSchema: {},
    },
    async () => {
      const db = await load();
      const today = dateKey();
      const input = {
        person: db.person.name,
        doses: todaysDoses(db).map(({ name, time, status }) => ({ name, time, status })),
        checkins: db.checkins.filter((c) => c.date === today).map(({ mood, note }) => ({ mood, note })),
        concerns: db.concerns
          .filter((c) => dateKey(new Date(c.at)) === today)
          .map(({ severity, message }) => ({ severity, message })),
      };
      const { text: digest, source } = await buildDigest(input);
      return text(digest, { source, ...input });
    },
  );

  return server;
}
