import bcrypt from "bcryptjs";

const COST = 12;

// A bcrypt hash of a random string nobody knows. Checking a login for an unknown user
// against it takes as long as a real check, so response time does not reveal which
// usernames exist.
export const DUMMY_HASH = "$2b$12$3SSPHMjb1.SMmm.sGbNhw.vxR9e69rvnkexuFM94UklRjfQ/UYFmC";

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 10) throw new Error("Use at least 10 characters.");
  // bcrypt only reads the first 72 bytes.
  if (Buffer.byteLength(password, "utf8") > 72) throw new Error("Use at most 72 bytes.");
  return bcrypt.hash(password, COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
