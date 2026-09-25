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

export interface Person {
  id: string;
  name: string;
  relation: string; // e.g. "mother"
  aliases: string[]; // lowercase ways a caregiver might refer to them: "mom", "asha"
  caregivers: string[];
  medications: Medication[];
  medLogs: MedLog[];
  checkins: Checkin[];
  concerns: Concern[];
}

export interface Db {
  people: Person[];
}

/** Minutes after the scheduled time before an unlogged dose counts as missed. */
export const GRACE_MINUTES = 60;

function seed(): Db {
  const caregivers = ["Ayush (son)", "Priya (daughter)"];
  const empty = () => ({ medLogs: [], checkins: [], concerns: [], caregivers: [...caregivers] });
  return {
    people: [
      {
        id: "asha", name: "Asha", relation: "mother", aliases: ["asha", "mom", "mother", "mum"], ...empty(),
        medications: [
          { id: "metformin", name: "Metformin", dose: "500 mg", times: ["08:00", "20:00"] },
          { id: "lisinopril", name: "Lisinopril", dose: "10 mg", times: ["08:00"] },
          { id: "vitd", name: "Vitamin D", dose: "1000 IU", times: ["13:00"] },
        ],
      },
      {
        id: "ravi", name: "Ravi", relation: "father", aliases: ["ravi", "dad", "father", "papa"], ...empty(),
        medications: [
          { id: "amlodipine", name: "Amlodipine", dose: "5 mg", times: ["09:00"] },
          { id: "atorvastatin", name: "Atorvastatin", dose: "20 mg", times: ["21:00"] },
        ],
      },
    ],
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

/** Data written before multi-person support has no `people`; treat it as absent. */
const validDb = (x: unknown): Db | undefined =>
  x && Array.isArray((x as Db).people) ? (x as Db) : undefined;

export async function load(): Promise<Db> {
  if (TABLE) {
    const res = await doc().send(new GetCommand({ TableName: TABLE, Key: KEY }));
    return validDb(res.Item?.db) ?? seed();
  }
  return (existsSync(FILE) ? validDb(JSON.parse(readFileSync(FILE, "utf8"))) : undefined) ?? seed();
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
export function todaysDoses(person: Person, now = new Date()): DoseView[] {
  const today = dateKey(now);
  const nowMin = minutesOfDay(now);
  const out: DoseView[] = [];
  for (const med of person.medications) {
    for (const time of med.times) {
      const log = person.medLogs.find(
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

/**
 * Which slot a "gave the pill" report refers to: the earliest overdue or due dose first
 * (catching up on missed doses), otherwise the next upcoming one.
 */
export function pickSlot(person: Person, medicationId: string, now = new Date()): string | undefined {
  const open = todaysDoses(person, now).filter(
    (d) => d.medicationId === medicationId && ["due", "missed", "upcoming"].includes(d.status),
  );
  const overdue = open.filter((d) => d.status !== "upcoming");
  return (overdue[0] ?? open[0])?.time; // todaysDoses is sorted by time
}

export function findMedication(person: Person, query: string) {
  const q = query.trim().toLowerCase();
  return person.medications.find((m) => m.id === q || m.name.toLowerCase().includes(q));
}

export type Resolved = { person: Person } | { error: string };

const names = (people: Person[]) => people.map((p) => `${p.name} (${p.relation})`).join(" or ");

/** Match a spoken reference ("mom", "Ravi") to a person; with no reference, only unambiguous when there is one person. */
export function resolvePerson(db: Db, query?: string): Resolved {
  const q = query?.trim().toLowerCase();
  if (q) {
    const hit = db.people.find((p) => p.id === q || p.name.toLowerCase() === q || p.aliases.includes(q));
    return hit ? { person: hit } : { error: `I don't know "${query}". I look after ${names(db.people)}.` };
  }
  return db.people.length === 1
    ? { person: db.people[0] }
    : { error: `Whom do you mean, ${names(db.people)}?` };
}

/** Like resolvePerson, but a medication name can identify the person when it is unique to one of them. */
export function resolveForMedication(db: Db, medication: string, query?: string): Resolved {
  if (query) return resolvePerson(db, query);
  const owners = db.people.filter((p) => findMedication(p, medication));
  if (owners.length === 1) return { person: owners[0] };
  return owners.length === 0
    ? { error: `Nobody I look after takes "${medication}".` }
    : { error: `Whom do you mean, ${names(owners)}?` };
}

/** Read-only view for the dashboard: everyone's doses and their latest concerns. */
export function dashboardState(db: Db) {
  return {
    people: db.people.map((p) => ({
      id: p.id,
      name: p.name,
      relation: p.relation,
      aliases: p.aliases,
      medications: p.medications.map((m) => m.name),
      doses: todaysDoses(p),
      checkins: p.checkins.slice(-5).reverse(),
      concerns: p.concerns.slice(-5).reverse(),
    })),
  };
}
