import { describe, expect, it } from "vitest";
import { SigningService } from "../src/core/signingService";

describe("SigningService trust model", () => {
  it("returns unknown for new external signers and supports trust overrides", async () => {
    const signerA = new SigningService(null);
    const verifierB = new SigningService(null);

    const payload = {
      schema_version: 2,
      artifact_id: crypto.randomUUID(),
      created_at_utc: new Date().toISOString(),
      source: {
        target_url: "https://example.com/",
        origin: "https://example.com",
        captured_by_extension_version: "test"
      },
      cookies: [],
      derived: {
        cookie_header: "a=b",
        cookie_count: 0
      }
    };

    const signed = await signerA.signPayload(payload);
    const assessedUnknown = await verifierB.assessSigner(signed.signature);
    expect(assessedUnknown.trustStatus).toBe("unknown");

    await verifierB.setSignerTrust(signed.keyFingerprint, "trusted");
    const assessedTrusted = await verifierB.assessSigner(signed.signature);
    expect(assessedTrusted.trustStatus).toBe("trusted");

    await verifierB.setSignerTrust(signed.keyFingerprint, "blocked");
    const assessedBlocked = await verifierB.assessSigner(signed.signature);
    expect(assessedBlocked.trustStatus).toBe("blocked");
  });

  it("always includes self signer in signer list", async () => {
    const signing = new SigningService(null);
    const list = await signing.listSigners();
    expect(list.some((item) => item.trust_status === "self")).toBe(true);
  });
});
