const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const KEY = Buffer.from(process.env.ENCRYPTION_KEY, "hex");

// Encrypts a plain text value (e.g. Aadhar number) into a Buffer
// suitable for storing in a "bytea" column.
function encryptValue(plainText) {
  const iv = crypto.randomBytes(12); // unique per encryption
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  // Store iv + authTag + encrypted data together, so we can decrypt later
  return Buffer.concat([iv, authTag, encrypted]);
}

// Decrypts a Buffer (read from a "bytea" column) back to plain text.
function decryptValue(buffer) {
  const iv = buffer.subarray(0, 12);
  const authTag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

// One-way hash for lookup/duplicate-checking (matches cust_aadhar_hash format).
function hashValue(plainText) {
  return crypto.createHash("sha256").update(plainText).digest("hex");
}

module.exports = { encryptValue, decryptValue, hashValue };