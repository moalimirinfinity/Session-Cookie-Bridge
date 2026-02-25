import { describe, expect, it } from "vitest";
import {
  isBridgeRequestMessage,
  isResponseEnvelope,
  MESSAGE_COPY_COOKIE_HEADER,
  MESSAGE_REQUEST_PLATFORM_DATA
} from "../src/shared/messages";

describe("message contract", () => {
  it("validates request payload shape", () => {
    expect(
      isBridgeRequestMessage({
        type: MESSAGE_REQUEST_PLATFORM_DATA,
        platform_id: "medium"
      })
    ).toBe(true);

    expect(
      isBridgeRequestMessage({
        type: MESSAGE_COPY_COOKIE_HEADER,
        platform_id: "medium",
        cookies: { sid: "s1", uid: "u1", xsrf: "x1" }
      })
    ).toBe(true);

    expect(
      isBridgeRequestMessage({
        type: MESSAGE_COPY_COOKIE_HEADER,
        platform_id: "medium"
      })
    ).toBe(false);
  });

  it("validates response envelope shape", () => {
    expect(
      isResponseEnvelope({
        ok: true,
        data: { any: "thing" }
      })
    ).toBe(true);

    expect(
      isResponseEnvelope({
        ok: false,
        error: {
          code: "PERMISSION_DENIED",
          message: "Denied"
        }
      })
    ).toBe(true);
  });

  it("rejects unknown error codes for contract-safe mapping", () => {
    expect(
      isResponseEnvelope({
        ok: false,
        error: {
          code: "SOME_UNKNOWN_CODE",
          message: "Nope"
        }
      })
    ).toBe(false);
  });
});
