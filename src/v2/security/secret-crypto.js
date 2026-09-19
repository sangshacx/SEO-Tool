const AAD = "seo-pro-v2:gsc-refresh-token:v1";

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const normalized = String(value ?? "").trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  let binary;
  try { binary = atob(padded); }
  catch { throw new TypeError("Encryption key must be valid base64."); }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function importAesKey(base64Key) {
  const bytes = base64ToBytes(base64Key);
  if (bytes.byteLength !== 32) throw new TypeError("Encryption key must decode to exactly 32 bytes.");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export function generateBase64EncryptionKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}

export async function encryptSecret(plaintext, base64Key) {
  if (typeof plaintext !== "string" || !plaintext) throw new TypeError("Secret plaintext is required.");
  const key = await importAesKey(base64Key);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(AAD) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
    version: 1,
  };
}

export async function decryptSecret(record, base64Key) {
  if (!record?.ciphertext || !record?.iv || Number(record?.version ?? 1) !== 1) {
    throw new TypeError("Encrypted secret record is invalid.");
  }
  const key = await importAesKey(base64Key);
  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(record.iv),
        additionalData: new TextEncoder().encode(AAD),
      },
      key,
      base64ToBytes(record.ciphertext),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new Error("Encrypted secret could not be decrypted.");
  }
}
