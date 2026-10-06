// Bundles the lab entry (and with it the cloth engine) into cloth-lab/dist/lab.js.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
await build({ entryPoints: [path.join(here, "main.ts")], bundle: true, format: "iife", outfile: path.join(here, "dist/lab.js"), sourcemap: "inline", logLevel: "info" });
