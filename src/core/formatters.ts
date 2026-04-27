import type { CookieMap } from "../shared/types";

export const MEDIUM_COOKIE_ORDER = ["sid", "uid", "xsrf", "cf_clearance", "_cfuvid"] as const;

export function quoteEnvValue(value: string): string {
  return shellSingleQuote(value);
}

export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function sortedCookieEntries(cookies: CookieMap): Array<[string, string]> {
  return Object.entries(cookies)
    .filter(([key, value]) => key.trim() && typeof value === "string")
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
}

export function formatCookieHeader(cookies: CookieMap, orderedKeys: readonly string[]): string {
  const byPriority: string[] = [];
  const seen = new Set<string>();

  for (const key of orderedKeys) {
    if (!Object.prototype.hasOwnProperty.call(cookies, key)) {
      continue;
    }
    const value = cookies[key];
    byPriority.push(`${key}=${value}`);
    seen.add(key);
  }

  for (const [key, value] of sortedCookieEntries(cookies)) {
    if (seen.has(key)) {
      continue;
    }
    byPriority.push(`${key}=${value}`);
  }

  return byPriority.join("; ");
}

export function formatMediumEnvBlock(cookies: CookieMap): string {
  const sid = cookies.sid ?? "";
  const uid = cookies.uid ?? "";
  const xsrf = cookies.xsrf ?? "";
  const cfClearance = cookies.cf_clearance ?? "";
  const cfuvid = cookies._cfuvid ?? "";

  return [
    `MEDIUM_SESSION=${quoteEnvValue("")}`,
    `MEDIUM_SESSION_SID=${quoteEnvValue(sid)}`,
    `MEDIUM_SESSION_UID=${quoteEnvValue(uid)}`,
    `MEDIUM_SESSION_XSRF=${quoteEnvValue(xsrf)}`,
    `MEDIUM_SESSION_CF_CLEARANCE=${quoteEnvValue(cfClearance)}`,
    `MEDIUM_SESSION_CFUVID=${quoteEnvValue(cfuvid)}`,
    `MEDIUM_CSRF=${quoteEnvValue("")}`,
    `MEDIUM_USER_REF=${quoteEnvValue("")}`
  ].join("\n");
}

export function formatMediumCliImportSnippet(cookieHeader: string): string {
  return `uv run bot auth-import --cookie-header ${shellSingleQuote(cookieHeader)}`;
}
