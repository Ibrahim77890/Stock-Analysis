import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

/** scrypt with OWASP's minimum parameters (N = 2^17, r = 8, p = 1). Stored as a self-describing string so the
 *  parameters can be raised later: scrypt$N$r$p$salt$hash (base64). Node's default memory limit is too low for N = 2^17. */
const N = 131072;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 256 * 1024 * 1024;

function derive(password: string, salt: Buffer, n: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, keylen, { N: n, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A fixed hash used to spend the same time when the name is unknown (no user enumeration by timing). */
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword("this-is-not-a-real-password");
  return dummy;
}
