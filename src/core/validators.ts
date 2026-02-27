import type {
  CookieMap,
  CookieRecordV2,
  ExportPayloadV1,
  SessionArtifactPayloadV2,
  SessionArtifactV2,
  SignatureEnvelopeV2
} from "../shared/types";

export function requiredPresence(cookies: CookieMap, requiredCookies: readonly string[]): Record<string, boolean> {
  const presence: Record<string, boolean> = {};
  for (const name of requiredCookies) {
    presence[name] = Boolean(cookies[name]);
  }
  return presence;
}

export function missingRequiredCookies(presence: Record<string, boolean>): string[] {
  return Object.entries(presence)
    .filter(([, present]) => !present)
    .map(([name]) => name)
    .sort();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isBase64Url(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function isCookieSameSite(value: unknown): value is CookieRecordV2["sameSite"] {
  return value === "no_restriction" || value === "lax" || value === "strict" || value === "unspecified";
}

export function validateCookieRecordV2(cookie: CookieRecordV2): string[] {
  const issues: string[] = [];
  if (!cookie.name) {
    issues.push("cookie.name is required");
  }
  if (typeof cookie.value !== "string") {
    issues.push("cookie.value must be a string");
  }
  if (!cookie.domain) {
    issues.push(`cookie.domain is required (${cookie.name || "unknown"})`);
  }
  if (!cookie.path || !cookie.path.startsWith("/")) {
    issues.push(`cookie.path must start with '/' (${cookie.name || "unknown"})`);
  }
  if (!isCookieSameSite(cookie.sameSite)) {
    issues.push(`cookie.sameSite is invalid (${cookie.name || "unknown"})`);
  }
  if (cookie.expirationDate !== undefined && (!Number.isFinite(cookie.expirationDate) || cookie.expirationDate <= 0)) {
    issues.push(`cookie.expirationDate is invalid (${cookie.name || "unknown"})`);
  }
  if (!cookie.storeId) {
    issues.push(`cookie.storeId is required (${cookie.name || "unknown"})`);
  }
  return issues;
}

export function validateSessionArtifactPayloadV2(payload: SessionArtifactPayloadV2): string[] {
  const issues: string[] = [];
  if (payload.schema_version !== 2) {
    issues.push("schema_version must be 2");
  }
  if (!payload.artifact_id || !isUuidLike(payload.artifact_id)) {
    issues.push("artifact_id must be a UUID");
  }
  if (!payload.created_at_utc || !isIsoTimestamp(payload.created_at_utc)) {
    issues.push("created_at_utc must be a valid ISO timestamp");
  }

  if (!payload.source?.target_url || !isNonEmptyString(payload.source.target_url)) {
    issues.push("source.target_url is required");
  } else {
    try {
      const parsedUrl = new URL(payload.source.target_url);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        issues.push("source.target_url must use http(s)");
      }
      if (!payload.source.origin || parsedUrl.origin !== payload.source.origin) {
        issues.push("source.origin must match source.target_url origin");
      }
    } catch {
      issues.push("source.target_url must be a valid URL");
    }
  }

  if (!payload.source?.origin || !isNonEmptyString(payload.source.origin)) {
    issues.push("source.origin is required");
  }
  if (!payload.source?.captured_by_extension_version || !isNonEmptyString(payload.source.captured_by_extension_version)) {
    issues.push("source.captured_by_extension_version is required");
  }

  if (!Array.isArray(payload.cookies)) {
    issues.push("cookies must be an array");
  } else {
    const seenCookieKeys = new Set<string>();
    for (const cookie of payload.cookies) {
      issues.push(...validateCookieRecordV2(cookie));
      const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
      if (seenCookieKeys.has(key)) {
        issues.push(`duplicate cookie entry detected (${key})`);
      } else {
        seenCookieKeys.add(key);
      }
    }
  }
  if (!payload.derived?.cookie_header) {
    issues.push("derived.cookie_header is required");
  }
  if (!Number.isInteger(payload.derived?.cookie_count) || (payload.derived?.cookie_count ?? -1) < 0) {
    issues.push("derived.cookie_count must be a non-negative integer");
  } else if (Array.isArray(payload.cookies) && payload.derived.cookie_count !== payload.cookies.length) {
    issues.push("derived.cookie_count must equal cookies.length");
  }
  return issues;
}

export function validateSignatureEnvelopeV2(signature: SignatureEnvelopeV2): string[] {
  const issues: string[] = [];
  if (signature.alg !== "ECDSA_P256_SHA256") {
    issues.push("signature.alg must be ECDSA_P256_SHA256");
  }
  if (!signature.key_id || !isUuidLike(signature.key_id)) {
    issues.push("signature.key_id must be a UUID");
  }
  if (!isObject(signature.public_key_jwk)) {
    issues.push("signature.public_key_jwk is required");
  }
  if (!signature.payload_sha256 || !isBase64Url(signature.payload_sha256)) {
    issues.push("signature.payload_sha256 is required");
  }
  if (!signature.signature_base64url || !isBase64Url(signature.signature_base64url)) {
    issues.push("signature.signature_base64url is required");
  }
  if (!signature.signed_at_utc || !isIsoTimestamp(signature.signed_at_utc)) {
    issues.push("signature.signed_at_utc is required");
  }
  return issues;
}

export function validateSessionArtifactV2(artifact: SessionArtifactV2): string[] {
  const issues = validateSessionArtifactPayloadV2(artifact);
  if (!artifact.signature) {
    issues.push("signature is required");
    return issues;
  }
  return issues.concat(validateSignatureEnvelopeV2(artifact.signature));
}

export function validateExportPayloadV1(payload: ExportPayloadV1): string[] {
  const issues: string[] = [];
  if (payload.schema_version !== 1) {
    issues.push("schema_version must be 1");
  }
  if (!payload.platform) {
    issues.push("platform is required");
  }
  if (!payload.created_at_utc) {
    issues.push("created_at_utc is required");
  }
  if (!payload.cookie_header) {
    issues.push("cookie_header is required");
  }
  if (!isObject(payload.cookies)) {
    issues.push("cookies must be an object");
  }
  if (!isObject(payload.required_present)) {
    issues.push("required_present must be an object");
  }
  if (!payload.env_block) {
    issues.push("env_block is required");
  }
  if (!payload.cli_import_snippet) {
    issues.push("cli_import_snippet is required");
  }
  return issues;
}

export function isSessionArtifactV2(value: unknown): value is SessionArtifactV2 {
  if (!isObject(value) || value.schema_version !== 2) {
    return false;
  }
  return validateSessionArtifactV2(value as unknown as SessionArtifactV2).length === 0;
}

export function isExportPayloadV1(value: unknown): value is ExportPayloadV1 {
  if (!isObject(value) || value.schema_version !== 1) {
    return false;
  }
  return validateExportPayloadV1(value as unknown as ExportPayloadV1).length === 0;
}
