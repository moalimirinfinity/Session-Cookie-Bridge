import type { CookieMap, ExportPayloadV1 } from "../shared/types";

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

export function validateExportPayloadV1(payload: ExportPayloadV1): string[] {
  const issues: string[] = [];
  if (payload.schema_version !== 1) {
    issues.push("schema_version must be 1");
  }
  if (payload.platform !== "medium") {
    issues.push("platform must be 'medium' in v1");
  }
  if (!payload.created_at_utc) {
    issues.push("created_at_utc is required");
  }
  if (!payload.cookie_header) {
    issues.push("cookie_header is required");
  }
  if (typeof payload.cookies !== "object" || payload.cookies === null) {
    issues.push("cookies must be an object");
  }
  if (typeof payload.required_present !== "object" || payload.required_present === null) {
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
