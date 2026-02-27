import { describe, expect, it } from "vitest";
import { buildSignedSessionArtifact } from "../src/core/exportService";
import { importNormalizedArtifact, normalizeArtifactJson } from "../src/core/importService";
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

function fakeCookieService(report: ImportReport): { setCookies: () => Promise<ImportReport> } {
  return {
    setCookies: async () => report
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
      )
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
      signing
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("SIGNATURE_INVALID");
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
      signing
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
});
