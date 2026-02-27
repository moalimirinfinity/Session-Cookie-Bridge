import { cookieMapFromRecords } from "./exportService";
import { formatCookieHeader } from "./formatters";
import { payloadWithoutSignature, SigningService } from "./signingService";
import { isExportPayloadV1, isSessionArtifactV2, validateSessionArtifactV2 } from "./validators";
import type { CookieMap, CookieRecordV2, ExportPayloadV1, ResponseEnvelope, SessionArtifactV2 } from "../shared/types";
import type { CookieService } from "./cookieService";

interface NormalizedArtifact {
  artifact: SessionArtifactV2;
  schema_version: 1 | 2;
  legacy_converted: boolean;
}

function toResponseError<T>(
  code: "INVALID_ARTIFACT" | "SIGNATURE_INVALID" | "UNSUPPORTED_COOKIE" | "IMPORT_FAILED" | "IMPORT_PARTIAL",
  message: string,
  details?: Record<string, unknown>
): ResponseEnvelope<T> {
  return {
    ok: false,
    error: {
      code,
      message,
      details
    }
  };
}

function legacyTargetUrl(platform: string): string {
  if (platform.toLowerCase() === "medium") {
    return "https://medium.com/";
  }
  return "https://example.com/";
}

function mapLegacyCookieMap(cookies: CookieMap, targetUrl: string): CookieRecordV2[] {
  const url = new URL(targetUrl);
  const baseDomain = url.hostname;
  return Object.entries(cookies)
    .filter(([name, value]) => Boolean(name.trim()) && typeof value === "string")
    .map(([name, value]) => ({
      name: name.trim(),
      value,
      domain: baseDomain,
      path: "/",
      secure: url.protocol === "https:",
      httpOnly: false,
      sameSite: "unspecified" as const,
      hostOnly: true,
      session: true,
      storeId: "0"
    }));
}

async function convertLegacyV1(payload: ExportPayloadV1, signingService: SigningService): Promise<NormalizedArtifact> {
  const targetUrl = legacyTargetUrl(payload.platform);
  const sourceUrl = new URL(targetUrl);
  const cookies = mapLegacyCookieMap(payload.cookies, sourceUrl.href);
  const cookieHeader = payload.cookie_header || formatCookieHeader(payload.cookies, []);
  const draft = {
    schema_version: 2 as const,
    artifact_id: crypto.randomUUID(),
    created_at_utc: payload.created_at_utc || new Date().toISOString(),
    source: {
      target_url: sourceUrl.href,
      origin: sourceUrl.origin,
      captured_by_extension_version: "legacy-v1-converted"
    },
    cookies,
    derived: {
      cookie_header: cookieHeader,
      cookie_count: cookies.length
    }
  };

  const signed = await signingService.signPayload(draft);
  return {
    artifact: {
      ...draft,
      signature: signed.signature
    },
    schema_version: 1,
    legacy_converted: true
  };
}

function validateCookieImportConstraints(record: CookieRecordV2, nowEpochSeconds: number): string | null {
  if (record.expirationDate !== undefined && !record.session && record.expirationDate <= nowEpochSeconds) {
    return "Cookie is expired.";
  }

  if (!record.domain.trim()) {
    return "Cookie domain is empty.";
  }

  if (!record.path.startsWith("/")) {
    return "Cookie path must start with '/'.";
  }

  if (record.sameSite === "no_restriction" && !record.secure) {
    return "SameSite=None cookies must be secure.";
  }

  if (record.name.startsWith("__Host-")) {
    if (!record.secure) {
      return "__Host- cookies must be secure.";
    }
    if (record.path !== "/") {
      return "__Host- cookies must have path '/'.";
    }
    if (!record.hostOnly) {
      return "__Host- cookies must be hostOnly.";
    }
  }

  if (record.name.startsWith("__Secure-") && !record.secure) {
    return "__Secure- cookies must be secure.";
  }

  return null;
}

export async function normalizeArtifactJson(
  artifactJson: string,
  signingService: SigningService
): Promise<ResponseEnvelope<NormalizedArtifact>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(artifactJson);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toResponseError("INVALID_ARTIFACT", `Artifact is not valid JSON: ${message}`);
  }

  if (isSessionArtifactV2(parsed)) {
    return {
      ok: true,
      data: {
        artifact: parsed,
        schema_version: 2,
        legacy_converted: false
      }
    };
  }

  if (isExportPayloadV1(parsed)) {
    return {
      ok: true,
      data: await convertLegacyV1(parsed, signingService)
    };
  }

  return toResponseError("INVALID_ARTIFACT", "Artifact schema is unsupported or invalid.");
}

export async function verifyNormalizedArtifact(
  normalized: NormalizedArtifact,
  signingService: SigningService
): Promise<ResponseEnvelope<{ key_fingerprint: string }>> {
  const artifactIssues = validateSessionArtifactV2(normalized.artifact);
  if (artifactIssues.length > 0) {
    return toResponseError("INVALID_ARTIFACT", `Artifact validation failed: ${artifactIssues.join(", ")}`);
  }

  const verification = await signingService.verifyPayload(
    payloadWithoutSignature(normalized.artifact),
    normalized.artifact.signature
  );
  if (!verification.valid) {
    return toResponseError("SIGNATURE_INVALID", "Artifact signature verification failed.", {
      key_fingerprint: verification.keyFingerprint
    });
  }

  return {
    ok: true,
    data: {
      key_fingerprint: verification.keyFingerprint
    }
  };
}

export async function verifyArtifactJson(
  artifactJson: string,
  signingService: SigningService
): Promise<ResponseEnvelope<{
  valid: boolean;
  schema_version: 1 | 2;
  key_fingerprint: string;
  cookie_count: number;
  legacy_converted: boolean;
}>> {
  const normalized = await normalizeArtifactJson(artifactJson, signingService);
  if (!normalized.ok) {
    return normalized;
  }

  const verification = await verifyNormalizedArtifact(normalized.data, signingService);
  if (!verification.ok) {
    return verification;
  }

  return {
    ok: true,
    data: {
      valid: true,
      schema_version: normalized.data.schema_version,
      key_fingerprint: verification.data.key_fingerprint,
      cookie_count: normalized.data.artifact.cookies.length,
      legacy_converted: normalized.data.legacy_converted
    }
  };
}

function buildUnsupportedEntries(artifact: SessionArtifactV2): Array<{ name: string; domain: string; path: string; reason: string }> {
  const nowEpochSeconds = Date.now() / 1000;
  const unsupported: Array<{ name: string; domain: string; path: string; reason: string }> = [];
  for (const cookie of artifact.cookies) {
    const reason = validateCookieImportConstraints(cookie, nowEpochSeconds);
    if (!reason) {
      continue;
    }
    unsupported.push({
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
      reason
    });
  }
  return unsupported;
}

export async function importNormalizedArtifact(
  normalized: NormalizedArtifact,
  cookieService: CookieService,
  signingService: SigningService
): Promise<ResponseEnvelope<{
  key_fingerprint: string;
  legacy_converted: boolean;
  report: {
    total: number;
    imported: number;
    failed: number;
    skipped: number;
    results: Array<{ name: string; domain: string; path: string; status: "imported" | "failed" | "skipped"; reason?: string }>;
  };
}>> {
  const verification = await verifyNormalizedArtifact(normalized, signingService);
  if (!verification.ok) {
    return verification;
  }

  const unsupported = buildUnsupportedEntries(normalized.artifact);
  const unsupportedLookup = new Map<string, string>();
  for (const entry of unsupported) {
    unsupportedLookup.set(`${entry.name}|${entry.domain}|${entry.path}`, entry.reason);
  }
  const importableCookies = normalized.artifact.cookies.filter((cookie) => {
    const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
    return !unsupportedLookup.has(key);
  });

  const serviceReport = await cookieService.setCookies(importableCookies);
  const skippedEntries = unsupported.map((entry) => ({
    name: entry.name,
    domain: entry.domain,
    path: entry.path,
    status: "skipped" as const,
    reason: entry.reason
  }));
  const report = {
    total: normalized.artifact.cookies.length,
    imported: serviceReport.imported,
    failed: serviceReport.failed,
    skipped: serviceReport.skipped + skippedEntries.length,
    results: [...serviceReport.results, ...skippedEntries]
  };

  if (report.imported === 0) {
    return toResponseError("IMPORT_FAILED", "No cookies were imported.", {
      report,
      key_fingerprint: verification.data.key_fingerprint
    });
  }

  if (report.failed > 0) {
    return toResponseError("IMPORT_PARTIAL", "Some cookies failed to import.", {
      report,
      key_fingerprint: verification.data.key_fingerprint
    });
  }

  return {
    ok: true,
    data: {
      key_fingerprint: verification.data.key_fingerprint,
      legacy_converted: normalized.legacy_converted,
      report
    }
  };
}

export function cookieHeaderFromArtifact(artifact: SessionArtifactV2): string {
  if (artifact.derived.cookie_header) {
    return artifact.derived.cookie_header;
  }
  const cookieMap = cookieMapFromRecords(artifact.cookies);
  return formatCookieHeader(cookieMap, []);
}
