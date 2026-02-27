import { formatCookieHeader } from "./formatters";
import { SigningService } from "./signingService";
import { missingRequiredCookies, requiredPresence, validateExportPayloadV1, validateSessionArtifactV2 } from "./validators";
import type { PlatformAdapter } from "../platforms/types";
import type {
  CookieMap,
  CookieRecordV2,
  ExportPayloadV1,
  ResponseEnvelope,
  SessionArtifactPayloadV2,
  SessionArtifactV2
} from "../shared/types";

function normalizeCookieNameValue(name: string, value: string): [string, string] | null {
  const normalizedName = name.trim();
  const normalizedValue = value.trim();
  if (!normalizedName || !normalizedValue) {
    return null;
  }
  return [normalizedName, normalizedValue];
}

function normalizeCookieMap(cookies: CookieMap): CookieMap {
  const normalized: CookieMap = {};
  for (const [key, value] of Object.entries(cookies)) {
    const pair = normalizeCookieNameValue(key, value);
    if (!pair) {
      continue;
    }
    normalized[pair[0]] = pair[1];
  }
  return normalized;
}

function normalizeCookieRecords(cookies: CookieRecordV2[]): CookieRecordV2[] {
  const unique = new Map<string, CookieRecordV2>();
  for (const cookie of cookies) {
    const pair = normalizeCookieNameValue(cookie.name, cookie.value);
    if (!pair) {
      continue;
    }
    const normalized: CookieRecordV2 = {
      ...cookie,
      name: pair[0],
      value: pair[1],
      path: cookie.path || "/",
      sameSite: cookie.sameSite || "unspecified",
      storeId: cookie.storeId || "0"
    };
    const key = `${normalized.name}|${normalized.domain}|${normalized.path}`;
    unique.set(key, normalized);
  }
  return [...unique.values()].sort((a, b) => {
    const aKey = `${a.domain}|${a.path}|${a.name}`;
    const bKey = `${b.domain}|${b.path}|${b.name}`;
    return aKey.localeCompare(bKey);
  });
}

export function cookieMapFromRecords(records: CookieRecordV2[]): CookieMap {
  const map: CookieMap = {};
  for (const cookie of records) {
    if (map[cookie.name]) {
      continue;
    }
    map[cookie.name] = cookie.value;
  }
  return map;
}

function cookieHeaderFromRecords(records: CookieRecordV2[]): string {
  const map = cookieMapFromRecords(records);
  return formatCookieHeader(map, []);
}

function getExtensionVersion(): string {
  if (typeof chrome === "undefined" || !chrome.runtime?.getManifest) {
    return "dev";
  }
  return chrome.runtime.getManifest().version;
}

export async function buildSignedSessionArtifact(
  targetUrl: string,
  cookies: CookieRecordV2[],
  signingService: SigningService
): Promise<ResponseEnvelope<{ artifact: SessionArtifactV2; key_fingerprint: string }>> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return {
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: `Invalid target URL: ${targetUrl}`
      }
    };
  }

  const normalizedCookies = normalizeCookieRecords(cookies);
  const payload: SessionArtifactPayloadV2 = {
    schema_version: 2,
    artifact_id: crypto.randomUUID(),
    created_at_utc: new Date().toISOString(),
    source: {
      target_url: parsedUrl.href,
      origin: parsedUrl.origin,
      captured_by_extension_version: getExtensionVersion()
    },
    cookies: normalizedCookies,
    derived: {
      cookie_header: cookieHeaderFromRecords(normalizedCookies),
      cookie_count: normalizedCookies.length
    }
  };

  const { signature, keyFingerprint } = await signingService.signPayload(payload);
  const artifact: SessionArtifactV2 = {
    ...payload,
    signature
  };

  const issues = validateSessionArtifactV2(artifact);
  if (issues.length > 0) {
    return {
      ok: false,
      error: {
        code: "API_FAILURE",
        message: `Generated v2 artifact is invalid: ${issues.join(", ")}`
      }
    };
  }

  return {
    ok: true,
    data: {
      artifact,
      key_fingerprint: keyFingerprint
    }
  };
}

// Legacy adapter compatibility for one release cycle.
export function buildLegacyExtractionBundle(
  adapter: PlatformAdapter,
  cookies: CookieMap
): ResponseEnvelope<{
  platform_id: string;
  platform_label: string;
  created_at_utc: string;
  cookie_header: string;
  cookies: CookieMap;
  required_present: Record<string, boolean>;
  missing_required: string[];
  env_block: string;
  cli_import_snippet: string;
  json_payload: ExportPayloadV1;
}> {
  const normalizedCookies = normalizeCookieMap(cookies);
  const requiredPresent = requiredPresence(normalizedCookies, adapter.requiredCookies);
  const missingRequired = missingRequiredCookies(requiredPresent);

  const jsonPayload = adapter.toJsonPayload(normalizedCookies);
  const payloadIssues = validateExportPayloadV1(jsonPayload);
  if (payloadIssues.length > 0) {
    return {
      ok: false,
      error: {
        code: "API_FAILURE",
        message: `Generated export payload is invalid: ${payloadIssues.join(", ")}`
      }
    };
  }

  const bundle = {
    platform_id: adapter.id,
    platform_label: adapter.label,
    created_at_utc: jsonPayload.created_at_utc,
    cookie_header: adapter.toCookieHeader(normalizedCookies),
    cookies: normalizedCookies,
    required_present: requiredPresent,
    missing_required: missingRequired,
    env_block: adapter.toEnvBlock(normalizedCookies),
    cli_import_snippet: jsonPayload.cli_import_snippet,
    json_payload: jsonPayload
  };

  if (missingRequired.length > 0) {
    return {
      ok: false,
      error: {
        code: "NOT_SIGNED_IN",
        message: `Missing required cookies for ${adapter.label}: ${missingRequired.join(", ")}`,
        details: {
          missing_required: missingRequired,
          required_present: requiredPresent,
          cookie_count: Object.keys(normalizedCookies).length
        }
      }
    };
  }

  return {
    ok: true,
    data: bundle
  };
}
