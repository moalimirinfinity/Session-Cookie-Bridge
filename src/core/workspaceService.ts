import type { ImportMode, ImportPreset, SaveVaultEntryInput, VaultEntry } from "../shared/types";

const DEFAULT_VAULT_STORAGE_KEY = "vault.v1";
const DEFAULT_PRESETS_STORAGE_KEY = "presets.v1";

interface RuntimeLike {
  lastError?: { message?: string };
}

interface ChromeStorageLike {
  get(
    keys: string | string[] | Record<string, unknown> | null,
    callback: (items: Record<string, unknown>) => void
  ): void;
  set(items: Record<string, unknown>, callback?: () => void): void;
}

interface VaultStore {
  version: 1;
  entries: VaultEntry[];
}

interface PresetStore {
  version: 1;
  presets: ImportPreset[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseHost(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const candidate = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(candidate).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export class WorkspaceService {
  private readonly storage: ChromeStorageLike | null;

  private readonly runtime: RuntimeLike | undefined;

  private readonly vaultStorageKey: string;

  private readonly presetsStorageKey: string;

  private vaultCache: VaultStore | null = null;

  private presetsCache: PresetStore | null = null;

  constructor(
    storage: ChromeStorageLike | null = null,
    vaultStorageKey = DEFAULT_VAULT_STORAGE_KEY,
    presetsStorageKey = DEFAULT_PRESETS_STORAGE_KEY
  ) {
    if (storage) {
      this.storage = storage;
    } else if (typeof chrome !== "undefined" && chrome.storage?.local) {
      this.storage = chrome.storage.local as ChromeStorageLike;
    } else {
      this.storage = null;
    }

    this.runtime = typeof chrome !== "undefined" ? (chrome.runtime as RuntimeLike) : undefined;
    this.vaultStorageKey = vaultStorageKey;
    this.presetsStorageKey = presetsStorageKey;
  }

  private runtimeErrorMessage(): string | null {
    return this.runtime?.lastError?.message ?? null;
  }

  private async loadStorageValue<T>(key: string): Promise<T | null> {
    if (!this.storage) {
      return null;
    }

    return new Promise((resolve, reject) => {
      this.storage?.get(key, (items) => {
        const runtimeError = this.runtimeErrorMessage();
        if (runtimeError) {
          reject(new Error(runtimeError));
          return;
        }

        const raw = items[key];
        if (raw === undefined || raw === null) {
          resolve(null);
          return;
        }
        resolve(raw as T);
      });
    });
  }

  private async saveStorageValue<T>(key: string, value: T): Promise<void> {
    if (!this.storage) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.storage?.set({ [key]: value }, () => {
        const runtimeError = this.runtimeErrorMessage();
        if (runtimeError) {
          reject(new Error(runtimeError));
          return;
        }
        resolve();
      });
    });
  }

  private async loadVaultStore(): Promise<VaultStore> {
    if (this.vaultCache) {
      return this.vaultCache;
    }

    const raw = await this.loadStorageValue<Partial<VaultStore>>(this.vaultStorageKey);
    const entries = Array.isArray(raw?.entries) ? raw.entries : [];
    const normalized: VaultStore = {
      version: 1,
      entries: entries
        .filter((entry): entry is VaultEntry => Boolean(entry && typeof entry === "object"))
        .sort((a, b) => b.updated_at_utc.localeCompare(a.updated_at_utc))
    };
    this.vaultCache = normalized;
    return normalized;
  }

  private async saveVaultStore(store: VaultStore): Promise<void> {
    this.vaultCache = store;
    await this.saveStorageValue(this.vaultStorageKey, store);
  }

  private async loadPresetStore(): Promise<PresetStore> {
    if (this.presetsCache) {
      return this.presetsCache;
    }

    const raw = await this.loadStorageValue<Partial<PresetStore>>(this.presetsStorageKey);
    const presets = Array.isArray(raw?.presets) ? raw.presets : [];
    const normalized: PresetStore = {
      version: 1,
      presets: presets
        .filter((preset): preset is ImportPreset => Boolean(preset && typeof preset === "object"))
        .sort((a, b) => a.host.localeCompare(b.host))
    };
    this.presetsCache = normalized;
    return normalized;
  }

  private async savePresetStore(store: PresetStore): Promise<void> {
    this.presetsCache = store;
    await this.saveStorageValue(this.presetsStorageKey, store);
  }

  async listVaultEntries(query?: string): Promise<VaultEntry[]> {
    const store = await this.loadVaultStore();
    const normalizedQuery = query?.trim().toLowerCase();
    const entries = store.entries.slice().sort((a, b) => b.updated_at_utc.localeCompare(a.updated_at_utc));
    if (!normalizedQuery) {
      return entries;
    }
    return entries.filter((entry) => {
      const text = `${entry.origin_host} ${entry.artifact_id} ${entry.signer_fingerprint}`.toLowerCase();
      return text.includes(normalizedQuery);
    });
  }

  async saveVaultEntry(input: SaveVaultEntryInput): Promise<VaultEntry> {
    const store = await this.loadVaultStore();
    const now = nowIso();
    const existingIndex = store.entries.findIndex(
      (entry) => entry.artifact_id === input.artifact_id && entry.signer_fingerprint === input.signer_fingerprint
    );

    const nextEntry: VaultEntry =
      existingIndex >= 0
        ? {
            ...store.entries[existingIndex],
            ...input,
            last_operation: input.last_operation,
            last_operation_at_utc: now,
            updated_at_utc: now
          }
        : {
            id: crypto.randomUUID(),
            artifact_json: input.artifact_json,
            artifact_id: input.artifact_id,
            origin_host: input.origin_host,
            created_at_utc: input.created_at_utc,
            signer_fingerprint: input.signer_fingerprint,
            signer_key_id: input.signer_key_id,
            trust_status: input.trust_status,
            updated_at_utc: now,
            last_operation: input.last_operation,
            last_operation_at_utc: now,
            import_mode: input.import_mode,
            target_url: input.target_url,
            report: input.report
          };

    if (existingIndex >= 0) {
      store.entries[existingIndex] = nextEntry;
    } else {
      store.entries.unshift(nextEntry);
    }

    store.entries = store.entries
      .slice()
      .sort((a, b) => b.updated_at_utc.localeCompare(a.updated_at_utc))
      .slice(0, 200);
    await this.saveVaultStore(store);
    return nextEntry;
  }

  async deleteVaultEntry(id: string): Promise<boolean> {
    const store = await this.loadVaultStore();
    const before = store.entries.length;
    store.entries = store.entries.filter((entry) => entry.id !== id);
    if (store.entries.length === before) {
      return false;
    }
    await this.saveVaultStore(store);
    return true;
  }

  async listPresets(): Promise<ImportPreset[]> {
    const store = await this.loadPresetStore();
    return [...store.presets].sort((a, b) => a.host.localeCompare(b.host));
  }

  async findPresetForHost(hostname: string): Promise<ImportPreset | null> {
    const store = await this.loadPresetStore();
    const normalized = hostname.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    return store.presets.find((preset) => preset.host === normalized) ?? null;
  }

  async upsertPreset(host: string, defaultMode: ImportMode, warningHint = ""): Promise<ImportPreset> {
    const normalizedHost = parseHost(host);
    if (!normalizedHost) {
      throw new Error(`Invalid host or URL: ${host}`);
    }

    const store = await this.loadPresetStore();
    const now = nowIso();
    const existingIndex = store.presets.findIndex((preset) => preset.host === normalizedHost);
    const nextPreset: ImportPreset =
      existingIndex >= 0
        ? {
            ...store.presets[existingIndex],
            default_mode: defaultMode,
            warning_hint: warningHint.trim(),
            updated_at_utc: now
          }
        : {
            id: crypto.randomUUID(),
            host: normalizedHost,
            default_mode: defaultMode,
            warning_hint: warningHint.trim(),
            updated_at_utc: now
          };

    if (existingIndex >= 0) {
      store.presets[existingIndex] = nextPreset;
    } else {
      store.presets.push(nextPreset);
    }

    store.presets = store.presets.slice().sort((a, b) => a.host.localeCompare(b.host));
    await this.savePresetStore(store);
    return nextPreset;
  }

  async deletePreset(id: string): Promise<boolean> {
    const store = await this.loadPresetStore();
    const before = store.presets.length;
    store.presets = store.presets.filter((preset) => preset.id !== id);
    if (store.presets.length === before) {
      return false;
    }
    await this.savePresetStore(store);
    return true;
  }
}
