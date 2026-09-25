import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

export interface Medication {
  id: string;
  name: string;
  dose: string;
  times: string[]; // "HH:MM" local time
}

export interface MedLog {
  medicationId: string;
  scheduledTime: string; // "HH:MM"
  date: string; // YYYY-MM-DD
  taken: boolean;
  note?: string;
  at: string; // ISO timestamp
}

export interface Checkin {
  date: string;
  mood: number; // 1-5
  note?: string;
  at: string;
}

export interface Concern {
  id: string;
  severity: "low" | "medium" | "high";
  message: string;
  notified: string[];
  at: string;
}

export interface Db {
  person: { name: string; caregivers: string[] };
  medications: Medication[];
  medLogs: MedLog[];
  checkins: Checkin[];
  concerns: Concern[];
}

/** Minutes after the scheduled time before an unlogged dose counts as missed. */
export const GRACE_MINUTES = 60;

function seed(): Db {
  return {
    person: { name: "Asha", caregivers: ["Ayush (son)", "Priya (daughter)"] },
    medications: [
      { id: "metformin", name: "Metformin", dose: "500 mg", times: ["08:00", "20:00"] },
      { id: "lisinopril", name: "Lisinopril", dose: "10 mg", times: ["08:00"] },
      { id: "vitd", name: "Vitamin D", dose: "1000 IU", times: ["13:00"] },
    ],
    medLogs: [],
    checkins: [],
    concerns: [],
  };
}

/**
 * Storage backend. DynamoDB when CARELOOP_TABLE is set (Lambda), otherwise a local JSON file.
 * The whole Db is one item keyed by person, so load-modify-save is the unit of work.
 * Fine for one household and a demo; a multi-writer product would use per-record items.
 */
const TABLE = process.env.CARELOOP_TABLE;
const FILE = process.env.CARELOOP_DATA ?? "data/careloop.json";
const KEY = { pk: "household#default" };

let ddb: DynamoDBDocumentClient | undefined;
const doc = () => (ddb ??= DynamoDBDocumentClient.from(new DynamoDBClient({})));

export async function load(): Promise<Db> {
  if (TABLE) {
    const res = await doc().send(new GetCommand({ TableName: TABLE, Key: KEY }));
    return (res.Item?.db as Db | undefined) ?? seed();
  }
  return existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as Db) : seed();
}

export async function save(db: Db): Promise<void> {
  if (TABLE) {
    await doc().send(new PutCommand({ TableName: TABLE, Item: { ...KEY, db } }));
    return;
  }
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(db, null, 2));
}

/** Household timezone; Lambda runs in UTC so dose times must be interpreted explicitly. */
const TZ = process.env.CARELOOP_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

function parts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export const dateKey = (d = new Date()): string => parts(d).date;
const minutesOfDay = (d: Date): number => parts(d).minutes;

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export type DoseStatus = "taken" | "skipped" | "upcoming" | "due" | "missed";

export interface DoseView {
  medicationId: string;
  name: string;
  dose: string;
  time: string;
  status: DoseStatus;
}

/** Every scheduled dose today with its status relative to `now`. */
export function todaysDoses(db: Db, now = new Date()): DoseView[] {
  const today = dateKey(now);
  const nowMin = minutesOfDay(now);
  const out: DoseView[] = [];
  for (const med of db.medications) {
    for (const time of med.times) {
      const log = db.medLogs.find(
        (l) => l.medicationId === med.id && l.scheduledTime === time && l.date === today,
      );
      let status: DoseStatus;
      if (log) status = log.taken ? "taken" : "skipped";
      else if (nowMin < minutes(time)) status = "upcoming";
      else if (nowMin <= minutes(time) + GRACE_MINUTES) status = "due";
      else status = "missed";
      out.push({ medicationId: med.id, name: med.name, dose: med.dose, time, status });
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

/** Closest scheduled slot to `now` for a medication that has no log yet today. */
export function pickSlot(db: Db, medicationId: string, now = new Date()): string | undefined {
  const open = todaysDoses(db, now).filter(
    (d) => d.medicationId === medicationId && ["due", "missed", "upcoming"].includes(d.status),
  );
  if (!open.length) return undefined;
  const nowMin = minutesOfDay(now);
  return open.sort(
    (a, b) => Math.abs(minutes(a.time) - nowMin) - Math.abs(minutes(b.time) - nowMin),
  )[0].time;
}

export function findMedication(db: Db, query: string) {
  const q = query.trim().toLowerCase();
  return db.medications.find((m) => m.id === q || m.name.toLowerCase().includes(q));
}
