import fs from "node:fs";
import path from "node:path";

const src = path.resolve("src/main/db/schema.sql");
const dest = path.resolve("dist/main/db/schema.sql");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
