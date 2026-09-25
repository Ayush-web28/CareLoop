# Friction log

Fill in from real experience as you go. Each entry: task, steps, expected vs actual, severity, workaround, suggestion.

## 1. Finding the right MCP transport for serverless
- **Task:** Run the MCP server on Lambda (no long-lived Node HTTP server).
- **Steps:** Looked in `@modelcontextprotocol/sdk` for a transport that takes a `Request` and returns a `Response`.
- **Expected:** Serverless usage documented alongside the Express example.
- **Actual:** Found `WebStandardStreamableHTTPServerTransport` only by listing the package's `server/` directory.
- **Severity:** Low. **Workaround:** Read the `.d.ts` file. **Suggestion:** Add a serverless/Lambda example to the SDK README.

## 2. (add your own: AWS account setup, Builder ID vs AWS account confusion, Alexa+ docs, etc.)
- Note: the AWS Builder ID profile page looks like an account but has no account ID or IAM keys.
