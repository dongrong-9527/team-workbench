import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Canonicalize both paths: deployments use a release-root symlink, and older
// Node versions must still execute verification and reject their runtime.
export function isMain(moduleUrl: string): boolean {
  if (!process.argv[1]) return false;
  return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(process.argv[1]);
}
