function collectNames(value, output) {
  if (Array.isArray(value)) {
    for (const item of value) collectNames(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value.results)) {
    for (const row of value.results) {
      if (typeof row?.name === "string") output.push(row.name);
    }
    return;
  }
  for (const child of Object.values(value)) collectNames(child, output);
}

const expected = process.argv.slice(2).sort();
if (!expected.length || new Set(expected).size !== expected.length) {
  throw new Error("Expected one or more distinct names.");
}

let source = "";
for await (const chunk of process.stdin) source += chunk;
let payload;
try {
  payload = JSON.parse(source);
} catch {
  throw new Error("D1 query did not return JSON.");
}

const actual = [];
collectNames(payload, actual);
actual.sort();
if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
  process.stderr.write(`Expected exactly ${expected.join(", ")}; received ${actual.join(", ") || "no names"}.\n`);
  process.exitCode = 1;
}
