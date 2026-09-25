import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./mcp.js";
import { load, todaysDoses } from "./store.js";

const PORT = Number(process.env.PORT ?? 3000);

export const app = express();
app.use(express.json());
app.use(express.static("public"));

// Stateless Streamable HTTP: a fresh server + transport per request.
app.post("/mcp", async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  }
});

const methodNotAllowed = (_req: express.Request, res: express.Response) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
};
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

// Read-only state for the demo dashboard.
app.get("/api/state", async (_req, res) => {
  const db = await load();
  res.json({
    person: db.person,
    doses: todaysDoses(db),
    checkins: db.checkins.slice(-5).reverse(),
    concerns: db.concerns.slice(-5).reverse(),
  });
});

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => console.log(`CareLoop MCP server on http://localhost:${PORT}/mcp`));
}
