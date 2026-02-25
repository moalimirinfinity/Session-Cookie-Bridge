import { missingRequiredCookies, requiredPresence, validateExportPayloadV1 } from "./validators";
import type { PlatformAdapter } from "../platforms/types";
import type { CookieMap, ExtractionBundle, ResponseEnvelope } from "../shared/types";

function normalizeCookieMap(cookies: CookieMap): CookieMap {
  const normalized: CookieMap = {};
  for (const [key, value] of Object.entries(cookies)) {
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    normalized[normalizedKey] = normalizedValue;
  }
  return normalized;
}

export function buildExtractionBundle(
  adapter: PlatformAdapter,
  cookies: CookieMap
): ResponseEnvelope<ExtractionBundle> {
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

  const bundle: ExtractionBundle = {
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
