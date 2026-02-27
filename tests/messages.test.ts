import { describe, expect, it } from "vitest";
import {
  isBridgeRequestMessage,
  isResponseEnvelope,
  MESSAGE_COPY_COOKIE_HEADER,
  MESSAGE_COPY_FIELD,
  MESSAGE_EXPORT_SESSION,
  MESSAGE_IMPORT_SESSION,
  MESSAGE_REQUEST_ACTIVE_TAB_CONTEXT,
  MESSAGE_VERIFY_ARTIFACT
} from "../src/shared/messages";

describe("message contract (v2 + legacy shim)", () => {
  it("accepts v2 request payloads", () => {
    expect(isBridgeRequestMessage({ type: MESSAGE_REQUEST_ACTIVE_TAB_CONTEXT })).toBe(true);
    expect(
      isBridgeRequestMessage({
        type: MESSAGE_EXPORT_SESSION,
        target_url: "https://example.com/"
      })
    ).toBe(true);
    expect(
      isBridgeRequestMessage({
        type: MESSAGE_VERIFY_ARTIFACT,
        artifact_json: "{}"
      })
    ).toBe(true);
    expect(
      isBridgeRequestMessage({
        type: MESSAGE_IMPORT_SESSION,
        artifact_json: "{}"
      })
    ).toBe(true);
    expect(
      isBridgeRequestMessage({
        type: MESSAGE_COPY_FIELD,
        field: "cookie_header",
        artifact_json: "{}"
      })
    ).toBe(true);
  });

  it("rejects malformed v2 payloads", () => {
    expect(
      isBridgeRequestMessage({
        type: MESSAGE_EXPORT_SESSION
      })
    ).toBe(false);

    expect(
      isBridgeRequestMessage({
        type: MESSAGE_COPY_FIELD,
        field: "not_allowed",
        artifact_json: "{}"
      })
    ).toBe(false);
  });

  it("keeps legacy request shape valid", () => {
    expect(
      isBridgeRequestMessage({
        type: MESSAGE_COPY_COOKIE_HEADER,
        platform_id: "medium",
        cookies: { sid: "s1", uid: "u1", xsrf: "x1" }
      })
    ).toBe(true);
  });

  it("accepts new error codes in response envelopes", () => {
    expect(
      isResponseEnvelope({
        ok: false,
        error: {
          code: "SIGNATURE_INVALID",
          message: "bad sig"
        }
      })
    ).toBe(true);

    expect(
      isResponseEnvelope({
        ok: false,
        error: {
          code: "IMPORT_PARTIAL",
          message: "some failed"
        }
      })
    ).toBe(true);
  });

  it("rejects unknown error codes", () => {
    expect(
      isResponseEnvelope({
        ok: false,
        error: {
          code: "DOES_NOT_EXIST",
          message: "nope"
        }
      })
    ).toBe(false);
  });
});
