import { describe, expect, it } from "vitest";
import { buildSignedSessionArtifact } from "../src/core/exportService";
import { cookieHeaderFromArtifact, importNormalizedArtifact, normalizeArtifactJson } from "../src/core/importService";
import { SigningService } from "../src/core/signingService";
import type { CookieRecordV2, ImportReport } from "../src/shared/types";

function baseCookies(): CookieRecordV2[] {
  return [
    {
      name: "sid",
      value: "sid-v",
      domain: "example.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      hostOnly: true,
      session: true,
      storeId: "0"
    },
    {
      name: "uid",
      value: "uid-v",
      domain: "example.com",
      path: "/",
      secure: true,
      httpOnly: false,
      sameSite: "lax",
      hostOnly: true,
      session: true,
      storeId: "0"
    }
  ];
}

function fakeCookieService(
  report: ImportReport,
  onSet?: (records: CookieRecordV2[]) => void,
  onReplace?: (targetUrl: string, records: CookieRecordV2[]) => void
): {
  setCookies: (records: CookieRecordV2[]) => Promise<ImportReport>;
  replaceCookiesForTargetUrl: (targetUrl: string, records: CookieRecordV2[]) => Promise<ImportReport>;
} {
  return {
    setCookies: async (records: CookieRecordV2[]) => {
      onSet?.(records);
      return report;
    },
    replaceCookiesForTargetUrl: async (targetUrl: string, records: CookieRecordV2[]) => {
      onReplace?.(targetUrl, records);
      onSet?.(records);
      return report;
    }
  };
}

describe("importService", () => {
  it("imports all cookies for a valid artifact", async () => {
    const signing = new SigningService(null);
    const artifact = await buildSignedSessionArtifact("https://example.com/", baseCookies(), signing);
    expect(artifact.ok).toBe(true);
    if (!artifact.ok) {
      return;
    }

    const normalized = await normalizeArtifactJson(JSON.stringify(artifact.data.artifact), signing);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) {
      return;
    }

    const result = await importNormalizedArtifact(
      normalized.data,
      fakeCookieService({
        total: 2,
        imported: 2,
        failed: 0,
        skipped: 0,
        results: [
          { name: "sid", domain: "example.com", path: "/", status: "imported" },
          { name: "uid", domain: "example.com", path: "/", status: "imported" }
        ]
      }) as never,
      signing
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.report.imported).toBe(2);
    expect(result.data.report.failed).toBe(0);
  });

  it("returns IMPORT_PARTIAL with accurate counts when some cookie sets fail", async () => {
    const signing = new SigningService(null);
    const artifact = await buildSignedSessionArtifact("https://example.com/", baseCookies(), signing);
    expect(artifact.ok).toBe(true);
    if (!artifact.ok) {
      return;
    }

    const normalized = await normalizeArtifactJson(JSON.stringify(artifact.data.artifact), signing);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) {
      return;
    }

    const result = await importNormalizedArtifact(
      normalized.data,
      fakeCookieService({
        total: 2,
        imported: 1,
        failed: 1,
        skipped: 0,
        results: [
          { name: "sid", domain: "example.com", path: "/", status: "imported" },
          { name: "uid", domain: "example.com", path: "/", status: "failed", reason: "set failed" }
        ]
      }) as never,
      signing
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("IMPORT_PARTIAL");
    expect(result.error.details?.report).toMatchObject({
      imported: 1,
      failed: 1,
      total: 2
    });
  });

  it("blocks import when signature verification fails", async () => {
    const signing = new SigningService(null);
    const artifact = await buildSignedSessionArtifact("https://example.com/", baseCookies(), signing);
    expect(artifact.ok).toBe(true);
    if (!artifact.ok) {
      return;
    }

    const tampered = {
      ...artifact.data.artifact,
      cookies: artifact.data.artifact.cookies.map((cookie, index) =>
        index === 0
          ? {
              ...cookie,
              value: "tampered"
            }
          : cookie
      ),
      derived: {
        ...artifact.data.artifact.derived,
        cookie_header: "sid=tampered; uid=uid-v"
      }
    };

    const normalized = await normalizeArtifactJson(JSON.stringify(tampered), signing);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) {
      return;
    }

    const result = await importNormalizedArtifact(
      normalized.data,
      fakeCookieService({
        total: 0,
        imported: 0,
        failed: 0,
        skipped: 0,
        results: []
      }) as never,
      signing,
      {
        importMode: "exact_replay"
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("SIGNATURE_INVALID");
  });

  it("recomputes copied cookie headers from artifact cookies", async () => {
    const signing = new SigningService(null);
    const artifact = await buildSignedSessionArtifact("https://example.com/", baseCookies(), signing);
    expect(artifact.ok).toBe(true);
    if (!artifact.ok) {
      return;
    }

    const mismatched = {
      ...artifact.data.artifact,
      derived: {
        ...artifact.data.artifact.derived,
        cookie_header: "sid=wrong"
      }
    };

    expect(cookieHeaderFromArtifact(mismatched)).toBe("sid=sid-v; uid=uid-v");
  });

  it("reports unsupported expired and prefix-invalid cookies", async () => {
    const signing = new SigningService(null);
    const artifact = await buildSignedSessionArtifact("https://example.com/", [
      {
        name: "__Secure-token",
        value: "a",
        domain: "example.com",
        path: "/",
        secure: false,
        httpOnly: false,
        sameSite: "lax",
        hostOnly: true,
        session: true,
        storeId: "0"
      },
      {
        name: "expired",
        value: "b",
        domain: "example.com",
        path: "/",
        secure: true,
        httpOnly: false,
        sameSite: "lax",
        expirationDate: 1,
        hostOnly: true,
        session: false,
        storeId: "0"
      },
      {
        name: "cross-site",
        value: "c",
        domain: "example.com",
        path: "/",
        secure: false,
        httpOnly: false,
        sameSite: "no_restriction",
        hostOnly: true,
        session: true,
        storeId: "0"
      }
    ], signing);
    expect(artifact.ok).toBe(true);
    if (!artifact.ok) {
      return;
    }

    const normalized = await normalizeArtifactJson(JSON.stringify(artifact.data.artifact), signing);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) {
      return;
    }

    const result = await importNormalizedArtifact(
      normalized.data,
      fakeCookieService({
        total: 0,
        imported: 0,
        failed: 0,
        skipped: 0,
        results: []
      }) as never,
      signing,
      {
        importMode: "exact_replay"
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("IMPORT_FAILED");
    expect(result.error.details?.report).toMatchObject({
      imported: 0,
      skipped: 3,
      total: 3
    });
  });

  it("replaces cookies against the current app host by key/value", async () => {
    const signing = new SigningService(null);
    const artifact = await buildSignedSessionArtifact(
      "https://source.example/",
      [
        {
          name: "sid",
          value: "sid-v",
          domain: ".source.example",
          path: "/auth",
          secure: true,
          httpOnly: true,
          sameSite: "lax",
          hostOnly: false,
          session: true,
          storeId: "1"
        },
        {
          name: "sid",
          value: "sid-v2",
          domain: ".source.example",
          path: "/other",
          secure: true,
          httpOnly: true,
          sameSite: "lax",
          hostOnly: false,
          session: true,
          storeId: "1"
        },
        {
          name: "xsrf",
          value: "x-1",
          domain: "source.example",
          path: "/",
          secure: true,
          httpOnly: false,
          sameSite: "lax",
          hostOnly: true,
          session: true,
          storeId: "1"
        }
      ],
      signing
    );
    expect(artifact.ok).toBe(true);
    if (!artifact.ok) {
      return;
    }

    const normalized = await normalizeArtifactJson(JSON.stringify(artifact.data.artifact), signing);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) {
      return;
    }

    let importedCookies: CookieRecordV2[] = [];
    let replaceTargetUrl = "";
    const result = await importNormalizedArtifact(
      normalized.data,
      fakeCookieService(
        {
          total: 2,
          imported: 2,
          failed: 0,
          skipped: 0,
          results: [
            { name: "sid", domain: "target.example", path: "/", status: "imported" },
            { name: "xsrf", domain: "target.example", path: "/", status: "imported" }
          ]
        },
        (records) => {
          importedCookies = records;
        },
        (targetUrl) => {
          replaceTargetUrl = targetUrl;
        }
      ) as never,
      signing,
      {
        targetUrl: "https://target.example/dashboard",
        importMode: "rewrite_current_app"
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(importedCookies).toHaveLength(2);
    expect(replaceTargetUrl).toBe("https://target.example/dashboard");
    expect(importedCookies).toEqual([
      expect.objectContaining({
        name: "sid",
        value: "sid-v2",
        domain: "target.example",
        path: "/",
        hostOnly: true,
        storeId: ""
      }),
      expect.objectContaining({
        name: "xsrf",
        value: "x-1",
        domain: "target.example",
        path: "/",
        hostOnly: true,
        storeId: ""
      })
    ]);
  });

  it("supports exact replay mode without host rewrite", async () => {
    const signing = new SigningService(null);
    const artifact = await buildSignedSessionArtifact(
      "https://source.example/",
      [
        {
          name: "sid",
          value: "sid-v",
          domain: ".source.example",
          path: "/auth",
          secure: true,
          httpOnly: true,
          sameSite: "lax",
          hostOnly: false,
          session: true,
          storeId: "1"
        }
      ],
      signing
    );
    expect(artifact.ok).toBe(true);
    if (!artifact.ok) {
      return;
    }

    const normalized = await normalizeArtifactJson(JSON.stringify(artifact.data.artifact), signing);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) {
      return;
    }

    let importedCookies: CookieRecordV2[] = [];
    let replaceCalled = false;
    const result = await importNormalizedArtifact(
      normalized.data,
      fakeCookieService(
        {
          total: 1,
          imported: 1,
          failed: 0,
          skipped: 0,
          results: [{ name: "sid", domain: ".source.example", path: "/auth", status: "imported" }]
        },
        (records) => {
          importedCookies = records;
        },
        () => {
          replaceCalled = true;
        }
      ) as never,
      signing,
      {
        importMode: "exact_replay",
        targetUrl: "https://target.example/dashboard"
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.data.mode_used).toBe("exact_replay");
    expect(replaceCalled).toBe(false);
    expect(importedCookies).toHaveLength(1);
    expect(importedCookies[0]).toMatchObject({
      domain: ".source.example",
      path: "/auth",
      hostOnly: false
    });
  });

  it("supports dry-run preflight without writing cookies", async () => {
    const signing = new SigningService(null);
    const artifact = await buildSignedSessionArtifact("https://example.com/", baseCookies(), signing);
    expect(artifact.ok).toBe(true);
    if (!artifact.ok) {
      return;
    }

    const normalized = await normalizeArtifactJson(JSON.stringify(artifact.data.artifact), signing);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) {
      return;
    }

    let setCalled = false;
    let replaceCalled = false;
    const result = await importNormalizedArtifact(
      normalized.data,
      fakeCookieService(
        {
          total: 0,
          imported: 0,
          failed: 0,
          skipped: 0,
          results: []
        },
        () => {
          setCalled = true;
        },
        () => {
          replaceCalled = true;
        }
      ) as never,
      signing,
      {
        importMode: "rewrite_current_app",
        targetUrl: "https://example.com/",
        dryRun: true
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(setCalled).toBe(false);
    expect(replaceCalled).toBe(false);
    expect(result.data.dry_run).toBe(true);
    expect(result.data.report.results.some((entry) => entry.status === "dry_run")).toBe(true);
  });

  it("blocks imports from blocked signers", async () => {
    const signer = new SigningService(null);
    const verifier = new SigningService(null);
    const artifact = await buildSignedSessionArtifact("https://example.com/", baseCookies(), signer);
    expect(artifact.ok).toBe(true);
    if (!artifact.ok) {
      return;
    }

    await verifier.setSignerTrust(artifact.data.key_fingerprint, "blocked");

    const normalized = await normalizeArtifactJson(JSON.stringify(artifact.data.artifact), verifier);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) {
      return;
    }

    const result = await importNormalizedArtifact(
      normalized.data,
      fakeCookieService({
        total: 0,
        imported: 0,
        failed: 0,
        skipped: 0,
        results: []
      }) as never,
      verifier
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("SIGNATURE_INVALID");
  });
});
