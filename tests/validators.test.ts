import { describe, expect, it } from "vitest";
import { buildSignedSessionArtifact } from "../src/core/exportService";
import { SigningService } from "../src/core/signingService";
import { validateSessionArtifactV2 } from "../src/core/validators";

describe("v2 artifact validator hardening", () => {
  it("rejects mismatched derived.cookie_count", async () => {
    const signing = new SigningService(null);
    const built = await buildSignedSessionArtifact(
      "https://example.com/",
      [
        {
          name: "sid",
          value: "a",
          domain: "example.com",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "lax",
          hostOnly: true,
          session: true,
          storeId: "0"
        }
      ],
      signing
    );

    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const tampered = {
      ...built.data.artifact,
      derived: {
        ...built.data.artifact.derived,
        cookie_count: 99
      }
    };

    const issues = validateSessionArtifactV2(tampered);
    expect(issues).toContain("derived.cookie_count must equal cookies.length");
  });

  it("rejects duplicate cookie entries", async () => {
    const signing = new SigningService(null);
    const built = await buildSignedSessionArtifact(
      "https://example.com/",
      [
        {
          name: "sid",
          value: "a",
          domain: "example.com",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "lax",
          hostOnly: true,
          session: true,
          storeId: "0"
        }
      ],
      signing
    );

    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const duplicate = {
      ...built.data.artifact,
      cookies: [...built.data.artifact.cookies, built.data.artifact.cookies[0]]
    };
    const issues = validateSessionArtifactV2(duplicate);
    expect(issues.some((issue) => issue.includes("duplicate cookie entry detected"))).toBe(true);
  });
});
