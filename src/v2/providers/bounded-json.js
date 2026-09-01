export const DEFAULT_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;

export class BoundedJsonError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "BoundedJsonError";
    this.code = code;
    this.httpStatus = 502;
    this.task_count = null;
    this.actual_cost_usd = null;
  }
}

export async function readBoundedJson(response, { maxBytes = DEFAULT_PROVIDER_RESPONSE_BYTES } = {}) {
  const rawLength = response.headers.get("content-length");
  if (rawLength && /^\d+$/.test(rawLength.trim()) && Number(rawLength) > maxBytes) {
    throw new BoundedJsonError("Provider response was unexpectedly large.", "PROVIDER_RESPONSE_TOO_LARGE");
  }
  if (!response.body) {
    throw new BoundedJsonError("Provider returned an empty response.", "PROVIDER_INVALID_RESPONSE");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BoundedJsonError("Provider response was unexpectedly large.", "PROVIDER_RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BoundedJsonError("Provider returned invalid JSON.", "PROVIDER_INVALID_RESPONSE");
  }
}
