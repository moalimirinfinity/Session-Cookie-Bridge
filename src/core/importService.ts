import { cookieIdentityKey } from "./cookieIdentity";
import { cookieMapFromRecords } from "./exportService";
import { formatCookieHeader } from "./formatters";
import { payloadWithoutSignature, SigningService } from "./signingService";
import { isExportPayloadV1, isSessionArtifactV2, validateSessionArtifactV2 } from "./validators";
import type {
  CookieMap,
  CookieRecordV2,
  ExportPayloadV1,
  ImportMode,
  ResponseEnvelope,
  SessionArtifactV2,
  SignerTrustStatus
} from "../shared/types";
import type { CookieService } from "./cookieService";

interface NormalizedArtifact {
  artifact: SessionArtifactV2;
  schema_version: 1 | 2;
  legacy_converted: boolean;
}

interface ImportNormalizedArtifactOptions {
  targetUrl?: string;
  importMode?: ImportMode;
  dryRun?: boolean;
}

interface VerificationResult {
  key_fingerprint: string;
  trust_status: SignerTrustStatus;
  trust_reason: string;
  signer_key_id: string;
}

interface ImportReportResult {
  total: number;
  imported: number;
  failed: number;
  skipped: number;
  results: Array<{ name: string; domain: string; path: string; status: "imported" | "failed" | "skipped" | "dry_run"; reason?: string }>;
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

async function convertLegacyV1(payload: ExportPayloadV1): Promise<NormalizedArtifact> {
  const targetUrl = legacyTargetUrl(payload.platform);
  const sourceUrl = new URL(targetUrl);
  const cookies = mapLegacyCookieMap(payload.cookies, sourceUrl.href);
  const cookieHeader = formatCookieHeader(payload.cookies, []);
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

  const legacySigner = new SigningService(null, "legacy-v1.ephemeral", "legacy-v1.trust", false);
  const signed = await legacySigner.signPayload(draft);
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
      data: await convertLegacyV1(parsed)
    };
  }

  return toResponseError("INVALID_ARTIFACT", "Artifact schema is unsupported or invalid.");
}

export async function verifyNormalizedArtifact(
  normalized: NormalizedArtifact,
  signingService: SigningService
): Promise<ResponseEnvelope<VerificationResult>> {
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

  const trust = await signingService.assessSigner(normalized.artifact.signature);
  if (trust.trustStatus === "blocked") {
    return toResponseError("SIGNATURE_INVALID", "Artifact signer is blocked.", {
      key_fingerprint: verification.keyFingerprint,
      trust_status: trust.trustStatus,
      trust_reason: trust.trustReason,
      signer_key_id: normalized.artifact.signature.key_id
    });
  }

  return {
    ok: true,
    data: {
      key_fingerprint: verification.keyFingerprint,
      trust_status: trust.trustStatus,
      trust_reason: trust.trustReason,
      signer_key_id: normalized.artifact.signature.key_id
    }
  };
}

function buildUnsupportedEntries(artifact: SessionArtifactV2): Array<{ cookie: CookieRecordV2; reason: string }> {
  const nowEpochSeconds = Date.now() / 1000;
  const unsupported: Array<{ cookie: CookieRecordV2; reason: string }> = [];
  for (const cookie of artifact.cookies) {
    const reason = validateCookieImportConstraints(cookie, nowEpochSeconds);
    if (!reason) {
      continue;
    }
    unsupported.push({ cookie, reason });
  }
  return unsupported;
}

function toCurrentAppCookieSet(cookies: CookieRecordV2[], targetUrl: string): CookieRecordV2[] {
  const target = new URL(targetUrl);
  const secure = target.protocol === "https:";
  const nowEpochSeconds = Date.now() / 1000;
  const byName = new Map<string, CookieRecordV2>();

  for (const cookie of cookies) {
    const name = cookie.name.trim();
    if (!name) {
      continue;
    }

    const expirationDate =
      typeof cookie.expirationDate === "number" && cookie.expirationDate > nowEpochSeconds
        ? cookie.expirationDate
        : undefined;

    byName.set(name, {
      ...cookie,
      name,
      domain: target.hostname,
      hostOnly: true,
      path: "/",
      secure,
      sameSite: !secure && cookie.sameSite === "no_restriction" ? "lax" : cookie.sameSite,
      expirationDate,
      session: expirationDate === undefined,
      storeId: "",
      partitionKey: undefined
    });
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function buildSkippedEntries(unsupported: Array<{ cookie: CookieRecordV2; reason: string }>): Array<{
  name: string;
  domain: string;
  path: string;
  status: "skipped";
  reason: string;
}> {
  return unsupported.map((entry) => ({
    name: entry.cookie.name,
    domain: entry.cookie.domain,
    path: entry.cookie.path,
    status: "skipped" as const,
    reason: entry.reason
  }));
}

function mergeImportReport(
  total: number,
  serviceReport: { imported: number; failed: number; skipped: number; results: ImportReportResult["results"] },
  skippedEntries: ImportReportResult["results"]
): ImportReportResult {
  return {
    total,
    imported: serviceReport.imported,
    failed: serviceReport.failed,
    skipped: serviceReport.skipped + skippedEntries.length,
    results: [...serviceReport.results, ...skippedEntries]
  };
}

export async function importNormalizedArtifact(
  normalized: NormalizedArtifact,
  cookieService: CookieService,
  signingService: SigningService,
  options: ImportNormalizedArtifactOptions = {}
): Promise<ResponseEnvelope<{
  key_fingerprint: string;
  legacy_converted: boolean;
  trust_status: SignerTrustStatus;
  mode_used: ImportMode;
  target_url_used: string;
  dry_run: boolean;
  report: ImportReportResult;
}>> {
  const verification = await verifyNormalizedArtifact(normalized, signingService);
  if (!verification.ok) {
    return verification;
  }

  const importMode = options.importMode ?? "rewrite_current_app";
  const targetUrl = options.targetUrl ?? normalized.artifact.source.target_url;

  let cookiesToImport = normalized.artifact.cookies;
  if (importMode === "rewrite_current_app") {
    try {
      cookiesToImport = toCurrentAppCookieSet(cookiesToImport, targetUrl);
    } catch {
      return toResponseError("INVALID_ARTIFACT", `Invalid import target URL: ${targetUrl}`);
    }
  }

  const artifactForImport: SessionArtifactV2 =
    cookiesToImport === normalized.artifact.cookies
      ? normalized.artifact
      : {
          ...normalized.artifact,
          cookies: cookiesToImport,
          derived: {
            ...normalized.artifact.derived,
            cookie_count: cookiesToImport.length
          }
        };

  const unsupported = buildUnsupportedEntries(artifactForImport);
  const unsupportedLookup = new Map<string, string>();
  for (const entry of unsupported) {
    unsupportedLookup.set(cookieIdentityKey(entry.cookie), entry.reason);
  }

  const importableCookies = artifactForImport.cookies.filter((cookie) => !unsupportedLookup.has(cookieIdentityKey(cookie)));
  const skippedEntries = buildSkippedEntries(unsupported);

  if (options.dryRun) {
    const report: ImportReportResult = {
      total: artifactForImport.cookies.length,
      imported: 0,
      failed: 0,
      skipped: skippedEntries.length,
      results: [
        ...importableCookies.map((cookie) => ({
          name: cookie.name,
          domain: cookie.domain,
          path: cookie.path,
          status: "dry_run" as const,
          reason: "Preflight passed; cookie would be imported."
        })),
        ...skippedEntries
      ]
    };

    if (report.results.filter((item) => item.status === "dry_run").length === 0) {
      return toResponseError("IMPORT_FAILED", "No cookies passed dry-run preflight.", {
        report,
        key_fingerprint: verification.data.key_fingerprint,
        trust_status: verification.data.trust_status
      });
    }

    return {
      ok: true,
      data: {
        key_fingerprint: verification.data.key_fingerprint,
        legacy_converted: normalized.legacy_converted,
        trust_status: verification.data.trust_status,
        mode_used: importMode,
        target_url_used: targetUrl,
        dry_run: true,
        report
      }
    };
  }

  let serviceReport: { imported: number; failed: number; skipped: number; results: ImportReportResult["results"] };
  try {
    serviceReport =
      importMode === "rewrite_current_app"
        ? await cookieService.replaceCookiesForTargetUrl(targetUrl, importableCookies)
        : await cookieService.setCookies(importableCookies);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toResponseError("IMPORT_FAILED", `Failed to replace current cookies: ${message}`, {
      key_fingerprint: verification.data.key_fingerprint,
      trust_status: verification.data.trust_status
    });
  }

  const report = mergeImportReport(artifactForImport.cookies.length, serviceReport, skippedEntries);

  if (report.imported === 0) {
    return toResponseError("IMPORT_FAILED", "No cookies were imported.", {
      report,
      key_fingerprint: verification.data.key_fingerprint,
      trust_status: verification.data.trust_status
    });
  }

  if (report.failed > 0) {
    return toResponseError("IMPORT_PARTIAL", "Some cookies failed to import.", {
      report,
      key_fingerprint: verification.data.key_fingerprint,
      trust_status: verification.data.trust_status
    });
  }

  return {
    ok: true,
    data: {
      key_fingerprint: verification.data.key_fingerprint,
      legacy_converted: normalized.legacy_converted,
      trust_status: verification.data.trust_status,
      mode_used: importMode,
      target_url_used: targetUrl,
      dry_run: false,
      report
    }
  };
}

export function cookieHeaderFromArtifact(artifact: SessionArtifactV2): string {
  const cookieMap = cookieMapFromRecords(artifact.cookies);
  return formatCookieHeader(cookieMap, []);
}
