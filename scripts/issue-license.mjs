import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import license from "../ide/extension/license.cjs";

const [email, plan, expires] = process.argv.slice(2);
const keyFile = process.env.THUNDER_LICENSE_SIGNING_KEY_FILE;
if (!email || !plan || !expires || !keyFile) {
  throw new Error("Set THUNDER_LICENSE_SIGNING_KEY_FILE and pass email, plan (annual, monthly or team), and an ISO expiry.");
}
const privateKey = createPrivateKey(await readFile(keyFile));
if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("The signing key must be Ed25519.");
const now = Date.now();
const value = license.encodeLicense({ email, plan, issuedAt: now, expiresAt: Date.parse(expires), tier: "pro" }, privateKey);
license.verifyLicense(value, createPublicKey(privateKey), now);
process.stdout.write(value + "\n");
