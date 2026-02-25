import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildExtractionBundle } from "../src/core/exportService";
import { validateExportPayloadV1 } from "../src/core/validators";
import { mediumAdapter } from "../src/platforms/medium.adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function collectTsFiles(rootDir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("buildExtractionBundle", () => {
  it("returns structured NOT_SIGNED_IN error when required cookies are missing", () => {
    const result = buildExtractionBundle(mediumAdapter, {
      sid: "sid-only"
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("NOT_SIGNED_IN");
    expect(result.error.details).toMatchObject({
      missing_required: ["uid", "xsrf"],
      required_present: {
        sid: true,
        uid: false,
        xsrf: false
      }
    });
  });

  it("produces schema-valid payload for complete Medium sessions", () => {
    const result = buildExtractionBundle(mediumAdapter, {
      sid: "sid-v",
      uid: "uid-v",
      xsrf: "xsrf-v",
      cf_clearance: "cf-v",
      _cfuvid: "cfu-v"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const payload = result.data.json_payload;
    expect(validateExportPayloadV1(payload)).toEqual([]);
    expect(payload.schema_version).toBe(1);
    expect(payload.platform).toBe("medium");
    expect(payload.cookie_header).toContain("sid=sid-v");
    expect(payload.required_present).toEqual({ sid: true, uid: true, xsrf: true });
  });

  it("does not rely on persistent storage APIs for cookie data", () => {
    const sourceRoot = path.resolve(__dirname, "../src");
    const tsFiles = collectTsFiles(sourceRoot);

    for (const file of tsFiles) {
      const content = readFileSync(file, "utf8");
      expect(content.includes("chrome.storage")).toBe(false);
      expect(content.includes("localStorage")).toBe(false);
      expect(content.includes("sessionStorage")).toBe(false);
    }
  });
});
