import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const source = path.resolve(import.meta.dirname, "../../../standalone/index.html");
const destination = path.resolve(
  import.meta.dirname,
  "../dist/standalone/index.html",
);

await mkdir(path.dirname(destination), { recursive: true });
await copyFile(source, destination);
