import {
  formatCookieHeader,
  formatMediumCliImportSnippet,
  formatMediumEnvBlock,
  MEDIUM_COOKIE_ORDER
} from "../core/formatters";
import { requiredPresence } from "../core/validators";
import type { CookieMap, ExportPayloadV1 } from "../shared/types";
import type { PlatformAdapter } from "./types";

const REQUIRED_COOKIES = ["sid", "uid", "xsrf"] as const;
const OPTIONAL_COOKIES = ["cf_clearance", "_cfuvid"] as const;

function createdAtUtc(): string {
  return new Date().toISOString();
}

export const mediumAdapter: PlatformAdapter = {
  id: "medium",
  label: "Medium",
  cookieUrl: "https://medium.com/",
  hostPatterns: ["https://medium.com/*"],
  requiredCookies: [...REQUIRED_COOKIES],
  optionalCookies: [...OPTIONAL_COOKIES],

  toCookieHeader(cookies: CookieMap): string {
    return formatCookieHeader(cookies, MEDIUM_COOKIE_ORDER);
  },

  toEnvBlock(cookies: CookieMap): string {
    return formatMediumEnvBlock(cookies);
  },

  toJsonPayload(cookies: CookieMap): ExportPayloadV1 {
    const cookieHeader = formatCookieHeader(cookies, MEDIUM_COOKIE_ORDER);
    const requiredPresent = requiredPresence(cookies, REQUIRED_COOKIES);
    return {
      schema_version: 1,
      platform: "medium",
      created_at_utc: createdAtUtc(),
      cookie_header: cookieHeader,
      cookies,
      required_present: requiredPresent,
      env_block: formatMediumEnvBlock(cookies),
      cli_import_snippet: formatMediumCliImportSnippet(cookieHeader)
    };
  }
};
