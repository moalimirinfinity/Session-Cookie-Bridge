import { describe, expect, it } from "vitest";
import { buildSignedSessionArtifact } from "../src/core/exportService";
import { payloadWithoutSignature, SigningService } from "../src/core/signingService";
import type { CookieRecordV2 } from "../src/shared/types";

function sampleCookies(): CookieRecordV2[] {
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

describe("buildSignedSessionArtifact", () => {
  it("builds schema-v2 signed artifact", async () => {
    const signingService = new SigningService(null);
    const result = await buildSignedSessionArtifact("https://example.com/", sampleCookies(), signingService);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.data.artifact.schema_version).toBe(2);
    expect(result.data.artifact.cookies).toHaveLength(2);
    expect(result.data.artifact.signature.alg).toBe("ECDSA_P256_SHA256");
    expect(result.data.artifact.derived.cookie_header).toContain("sid=sid-v");
    expect(result.data.key_fingerprint).not.toHaveLength(0);
  });

  it("verifies untouched payload and fails after tampering", async () => {
    const signingService = new SigningService(null);
    const result = await buildSignedSessionArtifact("https://example.com/", sampleCookies(), signingService);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const verifyOriginal = await signingService.verifyPayload(
      payloadWithoutSignature(result.data.artifact),
      result.data.artifact.signature
    );
    expect(verifyOriginal.valid).toBe(true);

    const tampered = {
      ...result.data.artifact,
      cookies: result.data.artifact.cookies.map((cookie, index) =>
        index === 0
          ? {
              ...cookie,
              value: "tampered"
            }
          : cookie
      )
    };

    const verifyTampered = await signingService.verifyPayload(payloadWithoutSignature(tampered), tampered.signature);
    expect(verifyTampered.valid).toBe(false);
  });
});
