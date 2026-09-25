# CareLoop

An Alexa+ caretaking assistant built as a **self-hosted MCP server** (Streamable HTTP, spec 2025-11-25+).
A family member can tell Alexa+ "I gave Mom her metformin" or "Dad felt dizzy this morning"; CareLoop logs it,
flags concerns to other caregivers, and writes a plain-language daily digest.

Built for the Amazon Developer Hackathon: Alexa+ track (simulated Alexa+ experience backed by a real MCP server) and the Open Source challenge.
The AWS deployment below is optional; everything runs locally without an AWS account.

## MCP tools

The care circle holds several people (seeded with Asha, mother, and Ravi, father), each with their own medications,
check-ins, concerns and caregivers. Tools take an optional `person` ("mom", "dad", a name). When it is omitted, read-only
tools cover everyone, `log_medication` infers the person from a medication that belongs to only one of them, and
`record_checkin` / `flag_concern` ask "Whom do you mean?".

| Tool | What it does |
| --- | --- |
| `list_people` | Who is in the care circle |
| `get_care_schedule` | Today's doses and their status |
| `log_medication` | Mark a dose taken/skipped (catches up the earliest overdue dose first) |
| `get_missed_doses` | Doses past the 60-minute grace window with nothing logged |
| `record_checkin` | Mood 1-5; low moods auto-notify that person's caregivers |
| `flag_concern` | Raise a concern and notify caregivers |
| `daily_summary` | Family digest per person, written by Amazon Bedrock when configured |

## Run

```bash
npm install
npm start          # http://localhost:3000  (MCP endpoint: /mcp)
npm test           # real MCP client -> HTTP -> tools smoke test
```

Open http://localhost:3000 for the simulated Alexa+ (type or use the mic) next to a live family dashboard.

## Amazon Bedrock (optional)

```bash
export AWS_REGION=us-east-1
export BEDROCK_MODEL_ID=<a Converse-capable model or inference profile ID you have access to>
```

Without `BEDROCK_MODEL_ID` the digest falls back to a deterministic template.

## Deploy to Render (free, no AWS)

`render.yaml` is a Blueprint: in Render choose New > Blueprint, connect this repo, and deploy. Data is stored in a JSON file on
Render's ephemeral disk, so it resets on redeploys and the free tier sleeps after inactivity (first request may take ~50s).

## Deploy to AWS

Architecture: Lambda Function URL (Node 22) -> Streamable HTTP MCP at `/mcp`, DynamoDB for state, Bedrock Converse for digests.
The same URL also serves the simulated Alexa+ demo at `/`.

Prerequisites: AWS CLI configured (`aws configure` or SSO), [SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html),
and Bedrock model access enabled for your chosen model in the console.

```bash
npm run build                       # bundles src/lambda.ts -> dist/lambda.mjs
sam deploy --template-file infra/template.yaml --guided
#   BedrockModelId: e.g. the ID of a Converse-capable model you have access to (blank = template digest)
#   Timezone:       IANA zone for judging dose times, e.g. Asia/Kolkata
```

The stack outputs `McpEndpoint` (register this as your MCP server) and `BaseUrl` (the demo UI).
`npm run test:lambda` exercises the built bundle with Function URL events, without needing AWS.

Notes: the Function URL is unauthenticated and the data is a single demo household, so use fake data only. Add an
authorizer or bearer-token check before real use. Data lives in one DynamoDB item (`load` -> modify -> `save`).

## Layout

- `src/mcp.ts`: tool definitions
- `src/server.ts`: Express + stateless Streamable HTTP transport at `/mcp` (local dev)
- `src/lambda.ts`: Lambda Function URL handler (same tools, Web-standard transport)
- `infra/template.yaml`: SAM template (Lambda, DynamoDB, IAM)
- `src/store.ts`: storage (DynamoDB when `CARELOOP_TABLE` is set, else JSON file) and dose-status logic
- `src/digest.ts`: Bedrock Converse call with template fallback
- `public/index.html`: simulated Alexa+ client + dashboard

## Not a medical device

CareLoop tracks and relays information. It gives no medical advice.

## License

MIT
