import type { CookieMap, ExportPayloadV1 } from "../shared/types";

export interface PlatformAdapter {
  id: string;
  label: string;
  cookieUrl: string;
  hostPatterns: string[];
  requiredCookies: string[];
  optionalCookies: string[];
  toCookieHeader(cookies: CookieMap): string;
  toEnvBlock(cookies: CookieMap): string;
  toJsonPayload(cookies: CookieMap): ExportPayloadV1;
}
