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

  it("rejects mismatched derived.cookie_header", async () => {
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
        cookie_header: "sid=different"
      }
    };

    const issues = validateSessionArtifactV2(tampered);
    expect(issues).toContain("derived.cookie_header must match cookies");
  });

  it("rejects malformed boolean cookie fields", async () => {
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

    const malformed = {
      ...built.data.artifact,
      cookies: [
        {
          ...built.data.artifact.cookies[0],
          secure: "yes",
          httpOnly: "no",
          hostOnly: "true",
          session: 1
        }
      ]
    };

    const issues = validateSessionArtifactV2(malformed as never);
    expect(issues).toContain("cookie.secure must be a boolean (sid)");
    expect(issues).toContain("cookie.httpOnly must be a boolean (sid)");
    expect(issues).toContain("cookie.hostOnly must be a boolean (sid)");
    expect(issues).toContain("cookie.session must be a boolean (sid)");
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

  it("allows same name/domain/path across different store partitions", async () => {
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
        },
        {
          name: "sid",
          value: "b",
          domain: "example.com",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "lax",
          hostOnly: true,
          session: true,
          storeId: "1"
        }
      ],
      signing
    );
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    const issues = validateSessionArtifactV2(built.data.artifact);
    expect(issues.some((issue) => issue.includes("duplicate cookie entry detected"))).toBe(false);
  });
});
