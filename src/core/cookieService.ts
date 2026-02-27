import type {
  CookieMap,
  CookieRecordV2,
  CookieSameSiteV2,
  ImportCookieResult,
  ImportReport
} from "../shared/types";

interface ChromePermissionsApi {
  contains(permissions: chrome.permissions.Permissions, callback: (result: boolean) => void): void;
  request(permissions: chrome.permissions.Permissions, callback: (granted: boolean) => void): void;
}

interface ChromeCookiesApi {
  getAll(details: chrome.cookies.GetAllDetails, callback: (cookies: chrome.cookies.Cookie[]) => void): void;
  set(details: chrome.cookies.SetDetails, callback: (cookie?: chrome.cookies.Cookie | null) => void): void;
}

interface ChromeLike {
  permissions: ChromePermissionsApi;
  cookies: ChromeCookiesApi;
  runtime?: { lastError?: { message?: string } };
}

function runtimeErrorMessage(api: ChromeLike): string | null {
  return api.runtime?.lastError?.message ?? null;
}

function containsPermission(api: ChromeLike, origins: string[]): Promise<boolean> {
  return new Promise((resolve, reject) => {
    api.permissions.contains({ origins }, (result) => {
      const errorMessage = runtimeErrorMessage(api);
      if (errorMessage) {
        reject(new Error(errorMessage));
        return;
      }
      resolve(result);
    });
  });
}

function requestPermission(api: ChromeLike, origins: string[]): Promise<boolean> {
  return new Promise((resolve, reject) => {
    api.permissions.request({ origins }, (granted) => {
      const errorMessage = runtimeErrorMessage(api);
      if (errorMessage) {
        reject(new Error(errorMessage));
        return;
      }
      resolve(granted);
    });
  });
}

function getAllCookies(api: ChromeLike, url: string): Promise<chrome.cookies.Cookie[]> {
  return new Promise((resolve, reject) => {
    api.cookies.getAll({ url }, (cookies) => {
      const errorMessage = runtimeErrorMessage(api);
      if (errorMessage) {
        reject(new Error(errorMessage));
        return;
      }
      resolve(cookies ?? []);
    });
  });
}

function setCookieRaw(api: ChromeLike, details: chrome.cookies.SetDetails): Promise<chrome.cookies.Cookie> {
  return new Promise((resolve, reject) => {
    api.cookies.set(details, (cookie) => {
      const errorMessage = runtimeErrorMessage(api);
      if (errorMessage) {
        reject(new Error(errorMessage));
        return;
      }
      if (!cookie) {
        reject(new Error("Cookie set returned no cookie."));
        return;
      }
      resolve(cookie);
    });
  });
}

function normalizeSameSite(value: chrome.cookies.Cookie["sameSite"]): CookieSameSiteV2 {
  if (value === "lax" || value === "strict" || value === "no_restriction") {
    return value;
  }
  return "unspecified";
}

function hostFromCookieDomain(domain: string): string {
  return domain.replace(/^\./, "").trim();
}

function escapeRegexPart(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toWildcardPattern(domain: string): string[] {
  const host = hostFromCookieDomain(domain);
  if (!host) {
    return [];
  }
  const hasLeadingDot = domain.startsWith(".");
  if (!hasLeadingDot) {
    return [`*://${host}/*`];
  }
  return [`*://*.${host}/*`, `*://${host}/*`];
}

function cookieSetUrl(record: CookieRecordV2): string {
  const host = hostFromCookieDomain(record.domain);
  const path = record.path?.startsWith("/") ? record.path : "/";
  const scheme = record.secure ? "https" : "http";
  return `${scheme}://${host}${path}`;
}

export class CookieService {
  private readonly chromeApi: ChromeLike;

  constructor(chromeApi: ChromeLike = chrome as unknown as ChromeLike) {
    this.chromeApi = chromeApi;
  }

  async hasHostPermission(hostPatterns: string[]): Promise<boolean> {
    return containsPermission(this.chromeApi, hostPatterns);
  }

  async requestHostPermission(hostPatterns: string[]): Promise<boolean> {
    return requestPermission(this.chromeApi, hostPatterns);
  }

  async ensureHostPermission(hostPatterns: string[], requestIfMissing = true): Promise<boolean> {
    const hasPermission = await this.hasHostPermission(hostPatterns);
    if (hasPermission || !requestIfMissing) {
      return hasPermission;
    }
    return this.requestHostPermission(hostPatterns);
  }

  buildHostPatternForTargetUrl(targetUrl: string): string {
    const parsed = new URL(targetUrl);
    return `${parsed.protocol}//${parsed.hostname}/*`;
  }

  buildRequiredHostPatterns(records: CookieRecordV2[]): string[] {
    const patterns = new Set<string>();
    for (const record of records) {
      for (const pattern of toWildcardPattern(record.domain)) {
        patterns.add(pattern);
      }
    }
    return [...patterns].sort((a, b) => a.localeCompare(b));
  }

  async getCookiesForUrl(url: string): Promise<CookieMap> {
    const cookies = await getAllCookies(this.chromeApi, url);
    const cookieMap: CookieMap = {};
    for (const cookie of cookies) {
      if (!cookie.name || !cookie.value) {
        continue;
      }
      cookieMap[cookie.name] = cookie.value;
    }
    return cookieMap;
  }

  async getCookiesForTargetUrl(targetUrl: string): Promise<CookieRecordV2[]> {
    const cookies = await getAllCookies(this.chromeApi, targetUrl);
    return cookies
      .map((cookie): CookieRecordV2 => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || "/",
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        sameSite: normalizeSameSite(cookie.sameSite),
        expirationDate: cookie.expirationDate,
        hostOnly: Boolean(cookie.hostOnly),
        session: Boolean(cookie.session),
        storeId: cookie.storeId || "0",
        partitionKey: cookie.partitionKey
          ? {
              topLevelSite: cookie.partitionKey.topLevelSite,
              hasCrossSiteAncestor: cookie.partitionKey.hasCrossSiteAncestor
            }
          : undefined
      }))
      .filter((cookie) => cookie.name && cookie.domain);
  }

  async setCookie(record: CookieRecordV2): Promise<ImportCookieResult> {
    const host = hostFromCookieDomain(record.domain);
    if (!host) {
      return {
        name: record.name,
        domain: record.domain,
        path: record.path || "/",
        status: "skipped",
        reason: "Cookie domain is empty."
      };
    }

    const details: chrome.cookies.SetDetails = {
      name: record.name,
      value: record.value,
      url: cookieSetUrl(record),
      path: record.path || "/",
      secure: record.secure,
      httpOnly: record.httpOnly,
      sameSite: record.sameSite,
      storeId: record.storeId || undefined,
      partitionKey: record.partitionKey
        ? {
            topLevelSite: record.partitionKey.topLevelSite,
            hasCrossSiteAncestor: record.partitionKey.hasCrossSiteAncestor
          }
        : undefined
    };

    if (!record.hostOnly) {
      details.domain = record.domain;
    }

    if (!record.session && typeof record.expirationDate === "number") {
      details.expirationDate = record.expirationDate;
    }

    try {
      await setCookieRaw(this.chromeApi, details);
      return {
        name: record.name,
        domain: record.domain,
        path: record.path || "/",
        status: "imported"
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        name: record.name,
        domain: record.domain,
        path: record.path || "/",
        status: "failed",
        reason: message
      };
    }
  }

  async setCookies(records: CookieRecordV2[]): Promise<ImportReport> {
    const results: ImportCookieResult[] = [];
    for (const record of records) {
      results.push(await this.setCookie(record));
    }

    const report: ImportReport = {
      total: results.length,
      imported: results.filter((entry) => entry.status === "imported").length,
      failed: results.filter((entry) => entry.status === "failed").length,
      skipped: results.filter((entry) => entry.status === "skipped").length,
      results
    };

    return report;
  }
}

export function cookieRecordMatchesDomain(record: CookieRecordV2, hostname: string): boolean {
  const normalizedHost = hostFromCookieDomain(hostname).toLowerCase();
  const normalizedDomain = hostFromCookieDomain(record.domain).toLowerCase();
  if (!normalizedHost || !normalizedDomain) {
    return false;
  }
  if (record.hostOnly) {
    return normalizedDomain === normalizedHost;
  }
  const matcher = new RegExp(`(^|\\.)${escapeRegexPart(normalizedDomain)}$`, "i");
  return matcher.test(normalizedHost);
}
