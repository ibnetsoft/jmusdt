import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { database } from "./db";

function encryptionKey() {
  const secret = process.env.TRONGRID_SETTINGS_ENCRYPTION_KEY || process.env.CRON_SECRET;
  if (!secret || secret.length < 32) throw new Error("API 키 암호화 설정이 필요합니다.");
  return createHash("sha256").update(secret).digest();
}
export function encryptTronKey(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}
export function decryptTronKey(value: string) {
  const [version, iv, tag, ciphertext, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext || extra) throw new Error("API 키 암호화 데이터 오류");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
let cached: { value: string; expires: number } | null = null;
export function clearTronKeyCache() { cached = null; }
export async function getTronGridKey() {
  if (cached && cached.expires > Date.now()) return cached.value;
  const result = await database().query("SELECT encrypted_key FROM tron_api_settings WHERE id=true");
  const value = result.rows[0] ? decryptTronKey(result.rows[0].encrypted_key) : (process.env.TRONGRID_API_KEY || "");
  cached = { value, expires: Date.now() + 30000 };
  return value;
}
