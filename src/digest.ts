import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const MODEL_ID = process.env.BEDROCK_MODEL_ID;
const REGION = process.env.AWS_REGION ?? "us-east-1";

export interface DigestInput {
  person: string;
  doses: { name: string; time: string; status: string }[];
  checkins: { mood: number; note?: string }[];
  concerns: { severity: string; message: string }[];
}

/** Deterministic summary; also the fallback when Bedrock is not configured. */
export function templateDigest(d: DigestInput): string {
  const taken = d.doses.filter((x) => x.status === "taken").length;
  const missed = d.doses.filter((x) => x.status === "missed");
  const parts = [`${d.person} has taken ${taken} of ${d.doses.length} doses today.`];
  if (missed.length) {
    parts.push(`Missed: ${missed.map((m) => `${m.name} at ${m.time}`).join(", ")}.`);
  }
  if (d.checkins.length) {
    const avg = d.checkins.reduce((s, c) => s + c.mood, 0) / d.checkins.length;
    parts.push(`Average mood is ${avg.toFixed(1)} out of 5.`);
  } else {
    parts.push("No check-in yet today.");
  }
  if (d.concerns.length) parts.push(`${d.concerns.length} concern(s) flagged.`);
  return parts.join(" ");
}

let client: BedrockRuntimeClient | undefined;

/** Warm, plain-language digest for family. Uses Bedrock when BEDROCK_MODEL_ID is set. */
export async function buildDigest(d: DigestInput): Promise<{ text: string; source: "bedrock" | "template" }> {
  if (!MODEL_ID) return { text: templateDigest(d), source: "template" };
  try {
    client ??= new BedrockRuntimeClient({ region: REGION });
    const res = await client.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [
          {
            text:
              "You write short, warm daily care updates for family members. Two to four sentences, " +
              "plain language, no medical advice, no invented facts. Mention missed doses and concerns clearly.",
          },
        ],
        messages: [{ role: "user", content: [{ text: JSON.stringify(d) }] }],
        inferenceConfig: { maxTokens: 300, temperature: 0.3 },
      }),
    );
    const text = res.output?.message?.content?.[0]?.text?.trim();
    if (text) return { text, source: "bedrock" };
  } catch (err) {
    console.error("Bedrock digest failed, using template:", (err as Error).message);
  }
  return { text: templateDigest(d), source: "template" };
}
