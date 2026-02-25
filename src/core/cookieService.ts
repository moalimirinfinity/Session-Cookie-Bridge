import type { CookieMap } from "../shared/types";

interface ChromePermissionsApi {
  contains(
    permissions: chrome.permissions.Permissions,
    callback: (result: boolean) => void
  ): void;
  request(
    permissions: chrome.permissions.Permissions,
    callback: (granted: boolean) => void
  ): void;
}

interface ChromeCookiesApi {
  getAll(details: chrome.cookies.GetAllDetails, callback: (cookies: chrome.cookies.Cookie[]) => void): void;
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
}
