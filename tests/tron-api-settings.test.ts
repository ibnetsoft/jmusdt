import test from "node:test";
import assert from "node:assert/strict";
import { encryptTronKey, decryptTronKey } from "../src/lib/tron-api-settings";

test("TRON API keys are encrypted with authenticated ciphertext", () => {
  const previous = process.env.TRONGRID_SETTINGS_ENCRYPTION_KEY;
  process.env.TRONGRID_SETTINGS_ENCRYPTION_KEY = "test-only-key-material-0123456789abcdef";
  try {
    const original = "test-api-key-do-not-use";
    const encrypted = encryptTronKey(original);
    assert.ok(!encrypted.includes(original));
    assert.notEqual(encrypted, encryptTronKey(original));
    assert.equal(decryptTronKey(encrypted), original);
    const parts = encrypted.split("."); parts[2] = Buffer.alloc(16).toString("base64url");
    assert.throws(() => decryptTronKey(parts.join(".")));
    process.env.TRONGRID_SETTINGS_ENCRYPTION_KEY = "different-key-material-0123456789abcdef";
    assert.throws(() => decryptTronKey(encrypted));
  } finally {
    if (previous === undefined) delete process.env.TRONGRID_SETTINGS_ENCRYPTION_KEY; else process.env.TRONGRID_SETTINGS_ENCRYPTION_KEY = previous;
  }
});
