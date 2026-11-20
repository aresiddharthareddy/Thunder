import fs from "node:fs";
import path from "node:path";
import { DEFAULT_LICENSE_PUBLIC_KEY, parseLicenseIssuer } from "../ide/extension/license.cjs";

const src = path.resolve("src/main/db/schema.sql");
const dest = path.resolve("dist/main/db/schema.sql");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
const issuerFile = process.env.THUNDER_LICENSE_PUBLIC_KEY_FILE;
const issuer = parseLicenseIssuer(issuerFile ? fs.readFileSync(issuerFile, "utf8") : DEFAULT_LICENSE_PUBLIC_KEY);
fs.writeFileSync(path.resolve("dist/main/license-public.pem"), issuer.export({ type: "spki", format: "pem" }));
