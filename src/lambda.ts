import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import indexHtml from "../public/index.html";
import { createServer } from "./mcp.js";
import { load, todaysDoses } from "./store.js";

const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Stateless Streamable HTTP: a fresh server + transport per invocation. */
async function handleMcp(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const url = `https://${event.requestContext.domainName}${event.rawPath}${event.rawQueryString ? `?${event.rawQueryString}` : ""}`;
  const body = event.body && event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body;
  const request = new Request(url, {
    method: event.requestContext.http.method,
    headers: event.headers as Record<string, string>,
    body,
  });

  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const res = await transport.handleRequest(request);
  const out: APIGatewayProxyResultV2 = {
    statusCode: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: await res.text(),
  };
  await transport.close();
  await server.close();
  return out;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const { method } = event.requestContext.http;
  const path = event.rawPath;
  try {
    if (path === "/mcp") {
      return method === "POST"
        ? await handleMcp(event)
        : json(405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
    }
    if (method === "GET" && path === "/api/state") {
      const db = await load();
      return json(200, {
        person: db.person,
        doses: todaysDoses(db),
        checkins: db.checkins.slice(-5).reverse(),
        concerns: db.concerns.slice(-5).reverse(),
      });
    }
    if (method === "GET" && path === "/") {
      return { statusCode: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: indexHtml };
    }
    return json(404, { error: "not found" });
  } catch (err) {
    console.error("request failed:", err);
    return json(500, { error: "internal error" });
  }
};
