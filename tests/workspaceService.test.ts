import { describe, expect, it } from "vitest";
import { WorkspaceService } from "../src/core/workspaceService";

function createStorageMock() {
  const bag: Record<string, unknown> = {};
  return {
    storage: {
      get: (
        keys: string | string[] | Record<string, unknown> | null,
        callback: (items: Record<string, unknown>) => void
      ) => {
        if (typeof keys === "string") {
          callback({ [keys]: bag[keys] });
          return;
        }
        callback({});
      },
      set: (items: Record<string, unknown>, callback?: () => void) => {
        Object.assign(bag, items);
        callback?.();
      }
    }
  };
}

describe("WorkspaceService", () => {
  it("stores, lists, filters, and deletes vault entries", async () => {
    const { storage } = createStorageMock();
    const service = new WorkspaceService(storage as never);

    const entry = await service.saveVaultEntry({
      artifact_json: "{\"schema_version\":2}",
      artifact_id: "a-1",
      origin_host: "example.com",
      created_at_utc: "2026-01-01T00:00:00.000Z",
      signer_fingerprint: "fingerprint-1",
      signer_key_id: "key-1",
      trust_status: "unknown",
      last_operation: "verify"
    });

    const list = await service.listVaultEntries();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(entry.id);

    const filtered = await service.listVaultEntries("example.com");
    expect(filtered).toHaveLength(1);

    const deleted = await service.deleteVaultEntry(entry.id);
    expect(deleted).toBe(true);
    expect(await service.listVaultEntries()).toHaveLength(0);
  });

  it("upserts and deletes presets", async () => {
    const { storage } = createStorageMock();
    const service = new WorkspaceService(storage as never);

    const first = await service.upsertPreset("https://example.com/path", "rewrite_current_app", "run dry-run");
    expect(first.host).toBe("example.com");

    const updated = await service.upsertPreset("example.com", "exact_replay", "");
    expect(updated.id).toBe(first.id);
    expect(updated.default_mode).toBe("exact_replay");

    const found = await service.findPresetForHost("example.com");
    expect(found?.id).toBe(first.id);

    const deleted = await service.deletePreset(first.id);
    expect(deleted).toBe(true);
    expect(await service.listPresets()).toHaveLength(0);
  });
});
