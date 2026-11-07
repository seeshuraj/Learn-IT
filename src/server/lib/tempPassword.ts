import crypto from "node:crypto";

/** 16-character temporary password with at least one upper-case letter, digit and symbol; no look-alike characters. */
export function generateTempPassword(): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*";
  const upper   = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits  = "23456789";
  const special = "!@#$%^&*";

  const buf = crypto.randomBytes(20);

  let pwd = "";
  pwd += upper[buf[0] % upper.length];
  pwd += digits[buf[1] % digits.length];
  pwd += special[buf[2] % special.length];

  for (let i = 3; i < 16; i++) {
    pwd += charset[buf[i] % charset.length];
  }

  const arr = crypto.randomBytes(pwd.length);
  const chars = pwd.split("");
  for (let i = chars.length - 1; i > 0; i--) {
    const j = arr[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  // Start with a letter or digit so spreadsheets never read it as a formula.
  const first = chars.findIndex(c => /[A-Za-z0-9]/.test(c));
  if (first > 0) [chars[0], chars[first]] = [chars[first], chars[0]];
  return chars.join("");
}
