# Demo video script (target 2:30, hard limit 3:00)

Record the browser at http://localhost:3000 (`npm start`). Speak to the mic button or type. Lead with the payoff.

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 | Dashboard with red "missed" doses | "Asha's family lives in three cities. Did she take her medication today? CareLoop answers that through Alexa+." |
| 0:15 | Ask: "Which doses were missed?" | Show the spoken reply and the `tools/call get_missed_doses` line: "Alexa+ is calling a real MCP server over Streamable HTTP." |
| 0:35 | "I gave mom her metformin" | Dose flips to green on the dashboard. |
| 0:55 | "Her mood is 2 today" | Concern appears, notified caregivers listed. "Low moods alert family automatically." |
| 1:15 | "She felt dizzy this morning" | High-severity concern raised. |
| 1:35 | "Give me the daily summary" | Read the digest aloud. |
| 1:55 | Terminal: `npm test` output, then `src/mcp.ts` | "Six MCP tools, tested with a real MCP client. Open source, MIT." |
| 2:15 | Repo URL on screen | "CareLoop: peace of mind for family caregivers." |

Rules: English, public YouTube/Vimeo, no copyrighted music, no third-party logos.
