// Starts each E2E run from an empty database and upload folder.
import fs from "node:fs";
import path from "node:path";

fs.rmSync(path.resolve(".e2e-data"), { recursive: true, force: true });
