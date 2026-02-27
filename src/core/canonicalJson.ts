function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function canonicalizeValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }

  if (isPlainObject(value)) {
    const output: Record<string, unknown> = {};
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      const normalized = canonicalizeValue(value[key]);
      if (normalized === undefined) {
        continue;
      }
      output[key] = normalized;
    }
    return output;
  }

  // JSON serialization drops undefined/functions/symbols and converts bigint throws.
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  throw new Error(`Unsupported value type for canonical JSON: ${typeof value}`);
}

export function toCanonicalJson(value: unknown): string {
  const normalized = canonicalizeValue(value);
  return JSON.stringify(normalized);
}

export function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
