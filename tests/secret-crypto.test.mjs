import assert from "node:assert/strict";
import test from "node:test";
import { decryptSecret, encryptSecret, generateBase64EncryptionKey } from "../src/v2/security/secret-crypto.js";

test("AES-GCM secret encryption round-trips without storing plaintext", async () => {
  const key = generateBase64EncryptionKey();
  const encrypted = await encryptSecret("refresh-token-secret", key);
  assert.notEqual(encrypted.ciphertext, "refresh-token-secret");
  assert.equal(encrypted.version, 1);
  assert.equal(await decryptSecret(encrypted, key), "refresh-token-secret");
});

test("AES-GCM rejects a different encryption key", async () => {
  const encrypted = await encryptSecret("refresh-token-secret", generateBase64EncryptionKey());
  await assert.rejects(() => decryptSecret(encrypted, generateBase64EncryptionKey()), /could not be decrypted/);
});
