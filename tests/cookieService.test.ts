import { describe, expect, it } from "vitest";
import { CookieService } from "../src/core/cookieService";
import type { CookieRecordV2 } from "../src/shared/types";

function createChromeMock() {
  let capturedSetDetails: chrome.cookies.SetDetails | null = null;
  const api = {
    permissions: {
      contains: (_permissions: chrome.permissions.Permissions, callback: (result: boolean) => void) => callback(true),
      request: (_permissions: chrome.permissions.Permissions, callback: (granted: boolean) => void) => callback(true)
    },
    cookies: {
      getAll: (_details: chrome.cookies.GetAllDetails, callback: (cookies: chrome.cookies.Cookie[]) => void) => {
        callback([
          {
            name: "sid",
            value: "sid-v",
            domain: ".example.com",
            hostOnly: false,
            path: "/",
            secure: true,
            httpOnly: true,
            session: true,
            sameSite: "lax",
            storeId: "0",
            id: 1
          } as unknown as chrome.cookies.Cookie
        ]);
      },
      set: (details: chrome.cookies.SetDetails, callback: (cookie?: chrome.cookies.Cookie | null) => void) => {
        capturedSetDetails = details;
        callback({
          name: details.name || "",
          value: details.value || "",
          domain: details.domain || "example.com",
          hostOnly: !details.domain,
          path: details.path || "/",
          secure: Boolean(details.secure),
          httpOnly: Boolean(details.httpOnly),
          session: !details.expirationDate,
          sameSite: details.sameSite || "unspecified",
          storeId: details.storeId || "0",
          id: 1
        } as unknown as chrome.cookies.Cookie);
      }
    },
    runtime: {}
  };

  return {
    api,
    getCapturedSetDetails: () => capturedSetDetails
  };
}

describe("CookieService", () => {
  it("maps chrome.cookies.Cookie to CookieRecordV2", async () => {
    const mock = createChromeMock();
    const service = new CookieService(mock.api as never);
    const cookies = await service.getCookiesForTargetUrl("https://example.com/");

    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({
      name: "sid",
      domain: ".example.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax"
    });
  });

  it("maps CookieRecordV2 to chrome.cookies.set details", async () => {
    const mock = createChromeMock();
    const service = new CookieService(mock.api as never);
    const cookie: CookieRecordV2 = {
      name: "__Host-token",
      value: "abc",
      domain: "example.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "strict",
      hostOnly: true,
      session: true,
      storeId: "0"
    };

    const result = await service.setCookie(cookie);
    expect(result.status).toBe("imported");

    const setDetails = mock.getCapturedSetDetails();
    expect(setDetails).not.toBeNull();
    expect(setDetails?.name).toBe("__Host-token");
    expect(setDetails?.url).toBe("https://example.com/");
    expect(setDetails?.domain).toBeUndefined();
    expect(setDetails?.secure).toBe(true);
  });

  it("builds required host patterns for hostOnly and domain cookies", () => {
    const mock = createChromeMock();
    const service = new CookieService(mock.api as never);
    const patterns = service.buildRequiredHostPatterns([
      {
        name: "a",
        value: "1",
        domain: "example.com",
        path: "/",
        secure: true,
        httpOnly: false,
        sameSite: "lax",
        hostOnly: true,
        session: true,
        storeId: "0"
      },
      {
        name: "b",
        value: "2",
        domain: ".example.org",
        path: "/",
        secure: true,
        httpOnly: false,
        sameSite: "lax",
        hostOnly: false,
        session: true,
        storeId: "0"
      }
    ]);

    expect(patterns).toEqual(["*://*.example.org/*", "*://example.com/*", "*://example.org/*"]);
  });
});
