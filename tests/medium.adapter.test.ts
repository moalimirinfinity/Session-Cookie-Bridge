import { describe, expect, it } from "vitest";
import { formatMediumCliImportSnippet } from "../src/core/formatters";
import { mediumAdapter } from "../src/platforms/medium.adapter";

describe("mediumAdapter", () => {
  it("defines required and optional cookie contracts", () => {
    expect(mediumAdapter.requiredCookies).toEqual(["sid", "uid", "xsrf"]);
    expect(mediumAdapter.optionalCookies).toEqual(["cf_clearance", "_cfuvid"]);
  });

  it("orders cookie header by fixed priority then alphabetical remainder", () => {
    const header = mediumAdapter.toCookieHeader({
      zeta: "z",
      uid: "user-1",
      sid: "sid-1",
      xsrf: "x-1",
      alpha: "a",
      _cfuvid: "cfuv-1",
      cf_clearance: "cfc-1"
    });

    expect(header).toBe(
      "sid=sid-1; uid=user-1; xsrf=x-1; cf_clearance=cfc-1; _cfuvid=cfuv-1; alpha=a; zeta=z"
    );
  });

  it("formats .env block line-by-line with expected Medium keys", () => {
    const envBlock = mediumAdapter.toEnvBlock({
      sid: "sid-value",
      uid: "uid-value",
      xsrf: "xsrf-value"
    });

    expect(envBlock).toBe(
      [
        'MEDIUM_SESSION=""',
        'MEDIUM_SESSION_SID="sid-value"',
        'MEDIUM_SESSION_UID="uid-value"',
        'MEDIUM_SESSION_XSRF="xsrf-value"',
        'MEDIUM_SESSION_CF_CLEARANCE=""',
        'MEDIUM_SESSION_CFUVID=""',
        'MEDIUM_CSRF=""',
        'MEDIUM_USER_REF=""'
      ].join("\n")
    );
  });

  it("escapes CLI snippet using shell-safe single quote escaping", () => {
    const snippet = formatMediumCliImportSnippet("sid=s1; uid=u'2; xsrf=x3");
    expect(snippet).toBe("uv run bot auth-import --cookie-header 'sid=s1; uid=u'\\''2; xsrf=x3'");
  });

  it("builds schema payload including required-present map", () => {
    const payload = mediumAdapter.toJsonPayload({
      sid: "sid-v",
      uid: "uid-v",
      xsrf: "xsrf-v"
    });

    expect(payload.schema_version).toBe(1);
    expect(payload.platform).toBe("medium");
    expect(payload.required_present).toEqual({ sid: true, uid: true, xsrf: true });
    expect(payload.cookie_header).toContain("sid=sid-v");
  });
});
