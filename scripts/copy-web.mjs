import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const src = path.resolve("apps/web/public");
const dest = path.resolve("dist/apps/web/public");
await mkdir(path.dirname(dest), { recursive: true });
await cp(src, dest, { recursive: true, force: true });
console.log(`copied ${src} -> ${dest}`);
