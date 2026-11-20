const crypto = require('node:crypto');

const DEFAULT_LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAX13Tb/tz/vd5893nHZhwwRi1DS2VoBURV+geDnSQDog=
-----END PUBLIC KEY-----`;
const plans = new Set(['annual', 'monthly', 'team']);

function payloadForSignature({ email, plan, issuedAt, expiresAt, tier }) {
  return { email, plan, issuedAt, expiresAt, tier };
}

function encodeLicense(payload, privateKey) {
  const unsigned = payloadForSignature(payload);
  const signature = crypto.sign(null, Buffer.from(JSON.stringify(unsigned)), privateKey).toString('base64url');
  return Buffer.from(JSON.stringify({ ...unsigned, signature })).toString('base64url');
}

function parseLicenseIssuer(pem) {
  const source = pem.trim();
  if (!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----$/.test(source)) {
    throw new Error('The license issuer must be an SPKI public key.');
  }
  const issuer = crypto.createPublicKey(source);
  if (issuer.asymmetricKeyType !== 'ed25519') throw new Error('The license issuer must use Ed25519.');
  return issuer;
}

function verifyLicense(licenseKey, publicKey, now = Date.now()) {
  if (typeof licenseKey !== 'string' || licenseKey.length > 8192 || !/^[A-Za-z0-9_-]+={0,2}$/.test(licenseKey)) {
    throw new Error('Enter a valid Thunder license key.');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(licenseKey, 'base64url').toString('utf8'));
  } catch {
    throw new Error('The license key could not be decoded.');
  }
  if (!payload || typeof payload.email !== 'string' || payload.email.length > 320 || !/^\S+@\S+$/.test(payload.email) ||
      !plans.has(payload.plan) || payload.tier !== 'pro' || !Number.isSafeInteger(payload.issuedAt) ||
      !Number.isSafeInteger(payload.expiresAt) || typeof payload.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(payload.signature)) {
    throw new Error('The license payload is invalid.');
  }
  const key = typeof publicKey === 'string' ? parseLicenseIssuer(publicKey) : publicKey;
  if (key?.type !== 'public' || key.asymmetricKeyType !== 'ed25519') throw new Error('The Thunder license verification key is invalid.');
  const unsigned = payloadForSignature(payload);
  if (!crypto.verify(null, Buffer.from(JSON.stringify(unsigned)), key, Buffer.from(payload.signature, 'base64url'))) {
    throw new Error('License signature is invalid.');
  }
  if (payload.expiresAt <= now) throw new Error('License has expired.');
  if (payload.issuedAt > now + 5 * 60_000 || payload.expiresAt <= payload.issuedAt) {
    throw new Error('The license validity period is invalid.');
  }
  return { ...unsigned, signature: payload.signature };
}

module.exports = { DEFAULT_LICENSE_PUBLIC_KEY, encodeLicense, parseLicenseIssuer, verifyLicense };
