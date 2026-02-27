import { describe, expect, it } from "vitest";
import { normalizeArtifactJson, verifyNormalizedArtifact } from "../src/core/importService";
import { SigningService } from "../src/core/signingService";
import { isBridgeRequestMessage, MESSAGE_REQUEST_PLATFORM_DATA } from "../src/shared/messages";

describe("legacy v1 compatibility", () => {
  it("converts v1 payload into importable signed v2 artifact", async () => {
    const signing = new SigningService(null);
    const v1Payload = {
      schema_version: 1,
      platform: "medium",
      created_at_utc: "2026-02-25T00:00:00.000Z",
      cookie_header: "sid=s1; uid=u1; xsrf=x1",
      cookies: {
        sid: "s1",
        uid: "u1",
        xsrf: "x1"
      },
      required_present: {
        sid: true,
        uid: true,
        xsrf: true
      },
      env_block: 'MEDIUM_SESSION=""',
      cli_import_snippet: "uv run bot auth-import --cookie-header 'sid=s1; uid=u1; xsrf=x1'"
    };

    const normalized = await normalizeArtifactJson(JSON.stringify(v1Payload), signing);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) {
      return;
    }

    expect(normalized.data.legacy_converted).toBe(true);
    expect(normalized.data.schema_version).toBe(1);
    expect(normalized.data.artifact.schema_version).toBe(2);
    expect(normalized.data.artifact.cookies.length).toBe(3);

    const verified = await verifyNormalizedArtifact(normalized.data, signing);
    expect(verified.ok).toBe(true);
  });

  it("keeps legacy platform route request shape valid", () => {
    expect(
      isBridgeRequestMessage({
        type: MESSAGE_REQUEST_PLATFORM_DATA,
        platform_id: "medium"
      })
    ).toBe(true);
  });
});
