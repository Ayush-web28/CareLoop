import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["src/lambda.ts"],
  outfile: "dist/lambda.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  loader: { ".html": "text" },
  // Node's Lambda runtime ships AWS SDK v3, so keep the bundle small.
  external: ["@aws-sdk/*"],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  minify: true,
});
console.log("built dist/lambda.mjs");
