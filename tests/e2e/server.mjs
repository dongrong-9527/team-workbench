// Test-only HTTPS host; no test routes are added to the production API.
import { createServer } from "vite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const dir = mkdtempSync(join(tmpdir(), "workbench-browser-"));
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    join(dir, "key.pem"),
    "-out",
    join(dir, "cert.pem"),
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ],
  { stdio: "ignore" },
);
const loader = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: "custom",
});
const { startFixture } = await loader.ssrLoadModule(
  "/tests/e2e/server-fixture.ts",
);
const api = await startFixture(dir);
const web = await createServer({
  root: "apps/web",
  configFile: "apps/web/vite.config.ts",
  define: { "import.meta.env.VITE_DEMO": '"true"' },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    https: {
      key: readFileSync(join(dir, "key.pem")),
      cert: readFileSync(join(dir, "cert.pem")),
    },
    proxy: { "/api": { target: "http://127.0.0.1:4174" } },
  },
});
await web.listen();
console.log("Synthetic HTTPS browser fixture ready");
async function close() {
  await web.close();
  await api.close();
  await loader.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
