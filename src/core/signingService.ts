import { toCanonicalJson, utf8Bytes } from "./canonicalJson";
import type { SignerRecord, SignerTrustDecision, SignerTrustStatus, SignatureEnvelopeV2 } from "../shared/types";

const DEFAULT_STORAGE_KEY = "signing.v1";
const DEFAULT_TRUST_STORAGE_KEY = "trust.v1";

interface SigningKeyMaterial {
  key_id: string;
  public_key_jwk: JsonWebKey;
  private_key_jwk: JsonWebKey;
}

interface TrustStoreEntry {
  key_fingerprint: string;
  signer_key_id: string;
  decision?: "trusted" | "blocked";
  updated_at_utc: string;
  last_seen_at_utc?: string;
}

interface TrustStore {
  version: 1;
  signers: Record<string, TrustStoreEntry>;
}

interface ChromeStorageLike {
  get(
    keys: string | string[] | Record<string, unknown> | null,
    callback: (items: Record<string, unknown>) => void
  ): void;
  set(items: Record<string, unknown>, callback?: () => void): void;
}

interface RuntimeLike {
  lastError?: { message?: string };
}

function bytesToBinary(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let output = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    output += String.fromCharCode(...chunk);
  }
  return output;
}

function toCryptoBufferSource(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
  ) {
    return bytes.buffer;
  }
  const cloned = new Uint8Array(bytes.byteLength);
  cloned.set(bytes);
  return cloned.buffer;
}

function toBase64Url(bytes: Uint8Array): string {
  const base64 =
    typeof btoa === "function"
      ? btoa(bytesToBinary(bytes))
      : Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  if (typeof atob === "function") {
    const binary = atob(padded);
    const output = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      output[i] = binary.charCodeAt(i);
    }
    return output;
  }
  return new Uint8Array(Buffer.from(padded, "base64"));
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getRuntime(): RuntimeLike | undefined {
  if (typeof chrome === "undefined") {
    return undefined;
  }
  return chrome.runtime as RuntimeLike;
}

function runtimeErrorMessage(runtime: RuntimeLike | undefined): string | null {
  return runtime?.lastError?.message ?? null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function trustReasonForStatus(status: SignerTrustStatus): string {
  switch (status) {
    case "self":
      return "Signed by this extension's current key.";
    case "trusted":
      return "Signer is explicitly trusted.";
    case "blocked":
      return "Signer is blocked by local trust policy.";
    case "unknown":
    default:
      return "Unknown signer. Signature is valid but not explicitly trusted.";
  }
}

async function sha256Bytes(input: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", toCryptoBufferSource(input));
  return new Uint8Array(digest);
}

async function digestCanonical(value: unknown): Promise<Uint8Array> {
  const canonical = toCanonicalJson(value);
  return sha256Bytes(utf8Bytes(canonical));
}

export class SigningService {
  private readonly storage: ChromeStorageLike | null;

  private readonly runtime: RuntimeLike | undefined;

  private readonly storageKey: string;

  private readonly trustStorageKey: string;

  private keyCache: SigningKeyMaterial | null = null;

  private trustCache: TrustStore | null = null;

  constructor(
    storage: ChromeStorageLike | null = null,
    storageKey = DEFAULT_STORAGE_KEY,
    trustStorageKey = DEFAULT_TRUST_STORAGE_KEY,
    useBrowserStorage = true
  ) {
    if (storage) {
      this.storage = storage;
    } else if (useBrowserStorage && typeof chrome !== "undefined" && chrome.storage?.local) {
      this.storage = chrome.storage.local as ChromeStorageLike;
    } else {
      this.storage = null;
    }
    this.runtime = getRuntime();
    this.storageKey = storageKey;
    this.trustStorageKey = trustStorageKey;
  }

  private async loadStorageValue<T>(key: string): Promise<T | null> {
    const storage = this.storage;
    if (!storage) {
      return null;
    }

    return new Promise((resolve, reject) => {
      storage.get(key, (items) => {
        const runtimeError = runtimeErrorMessage(this.runtime);
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
    const storage = this.storage;
    if (!storage) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      storage.set({ [key]: value }, () => {
        const runtimeError = runtimeErrorMessage(this.runtime);
        if (runtimeError) {
          reject(new Error(runtimeError));
          return;
        }
        resolve();
      });
    });
  }

  private async loadKeyMaterial(): Promise<SigningKeyMaterial | null> {
    if (!this.storage) {
      return this.keyCache;
    }

    const raw = await this.loadStorageValue<Partial<SigningKeyMaterial>>(this.storageKey);
    if (!raw || typeof raw !== "object") {
      return null;
    }
    if (!raw.key_id || !raw.public_key_jwk || !raw.private_key_jwk) {
      return null;
    }

    return {
      key_id: raw.key_id,
      public_key_jwk: raw.public_key_jwk,
      private_key_jwk: raw.private_key_jwk
    };
  }

  private async saveKeyMaterial(material: SigningKeyMaterial): Promise<void> {
    this.keyCache = material;
    await this.saveStorageValue(this.storageKey, material);
  }

  private async loadTrustStore(): Promise<TrustStore> {
    if (this.trustCache) {
      return this.trustCache;
    }

    const raw = await this.loadStorageValue<Partial<TrustStore>>(this.trustStorageKey);
    const signers = raw?.signers && typeof raw.signers === "object" ? raw.signers : {};
    const normalized: TrustStore = {
      version: 1,
      signers: {}
    };

    for (const [key, value] of Object.entries(signers)) {
      if (!value || typeof value !== "object") {
        continue;
      }

      const maybe = value as Partial<TrustStoreEntry>;
      normalized.signers[key] = {
        key_fingerprint: key,
        signer_key_id: typeof maybe.signer_key_id === "string" ? maybe.signer_key_id : "",
        decision: maybe.decision === "trusted" || maybe.decision === "blocked" ? maybe.decision : undefined,
        updated_at_utc: typeof maybe.updated_at_utc === "string" ? maybe.updated_at_utc : nowIso(),
        last_seen_at_utc: typeof maybe.last_seen_at_utc === "string" ? maybe.last_seen_at_utc : undefined
      };
    }

    this.trustCache = normalized;
    return normalized;
  }

  private async saveTrustStore(store: TrustStore): Promise<void> {
    this.trustCache = store;
    await this.saveStorageValue(this.trustStorageKey, store);
  }

  private async createKeyMaterial(): Promise<SigningKeyMaterial> {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "ECDSA",
        namedCurve: "P-256"
      },
      true,
      ["sign", "verify"]
    );

    const public_key_jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const private_key_jwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    return {
      key_id: crypto.randomUUID(),
      public_key_jwk,
      private_key_jwk
    };
  }

  private async importPrivateKey(privateKeyJwk: JsonWebKey): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      "jwk",
      privateKeyJwk,
      {
        name: "ECDSA",
        namedCurve: "P-256"
      },
      false,
      ["sign"]
    );
  }

  private async importPublicKey(publicKeyJwk: JsonWebKey): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      "jwk",
      publicKeyJwk,
      {
        name: "ECDSA",
        namedCurve: "P-256"
      },
      false,
      ["verify"]
    );
  }

  private async isMaterialUsable(material: SigningKeyMaterial): Promise<boolean> {
    try {
      await this.importPrivateKey(material.private_key_jwk);
      await this.importPublicKey(material.public_key_jwk);
      return true;
    } catch {
      return false;
    }
  }

  private async getOrCreateMaterial(): Promise<SigningKeyMaterial> {
    if (this.keyCache) {
      return this.keyCache;
    }
    const existing = await this.loadKeyMaterial();
    if (existing && (await this.isMaterialUsable(existing))) {
      this.keyCache = existing;
      return existing;
    }

    const created = await this.createKeyMaterial();
    await this.saveKeyMaterial(created);
    return created;
  }

  private async currentKeyFingerprint(): Promise<string> {
    const material = await this.getOrCreateMaterial();
    return this.fingerprintFromPublicKey(material.public_key_jwk);
  }

  private signerStatus(entry: TrustStoreEntry | undefined, selfFingerprint: string, fingerprint: string): SignerTrustStatus {
    if (fingerprint === selfFingerprint) {
      return "self";
    }
    if (entry?.decision === "trusted") {
      return "trusted";
    }
    if (entry?.decision === "blocked") {
      return "blocked";
    }
    return "unknown";
  }

  private toSignerRecord(entry: TrustStoreEntry, selfFingerprint: string): SignerRecord {
    const trustStatus = this.signerStatus(entry, selfFingerprint, entry.key_fingerprint);
    return {
      key_fingerprint: entry.key_fingerprint,
      signer_key_id: entry.signer_key_id,
      trust_status: trustStatus,
      trust_reason: trustReasonForStatus(trustStatus),
      updated_at_utc: entry.updated_at_utc,
      last_seen_at_utc: entry.last_seen_at_utc
    };
  }

  async ensureKeyHealth(): Promise<{ ok: true; key_fingerprint: string; signer_key_id: string } | { ok: false; error_message: string }> {
    try {
      const material = await this.getOrCreateMaterial();
      const keyFingerprint = await this.fingerprintFromPublicKey(material.public_key_jwk);
      return {
        ok: true,
        key_fingerprint: keyFingerprint,
        signer_key_id: material.key_id
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error_message: message
      };
    }
  }

  async fingerprintFromPublicKey(publicKeyJwk: JsonWebKey): Promise<string> {
    const digest = await digestCanonical(publicKeyJwk);
    return toHex(digest).slice(0, 24);
  }

  async signPayload(payloadWithoutSignature: unknown): Promise<{ signature: SignatureEnvelopeV2; keyFingerprint: string }> {
    let material = await this.getOrCreateMaterial();
    const canonicalPayload = toCanonicalJson(payloadWithoutSignature);
    const payloadBytes = utf8Bytes(canonicalPayload);
    const payloadDigest = await sha256Bytes(payloadBytes);
    let privateKey: CryptoKey;
    try {
      privateKey = await this.importPrivateKey(material.private_key_jwk);
    } catch {
      material = await this.createKeyMaterial();
      await this.saveKeyMaterial(material);
      privateKey = await this.importPrivateKey(material.private_key_jwk);
    }

    const signatureBuffer = await crypto.subtle.sign(
      {
        name: "ECDSA",
        hash: "SHA-256"
      },
      privateKey,
      toCryptoBufferSource(payloadBytes)
    );

    const signature = {
      alg: "ECDSA_P256_SHA256" as const,
      key_id: material.key_id,
      public_key_jwk: material.public_key_jwk,
      payload_sha256: toBase64Url(payloadDigest),
      signature_base64url: toBase64Url(new Uint8Array(signatureBuffer)),
      signed_at_utc: nowIso()
    };

    const keyFingerprint = await this.fingerprintFromPublicKey(material.public_key_jwk);
    return { signature, keyFingerprint };
  }

  async verifyPayload(payloadWithoutSignature: unknown, signature: SignatureEnvelopeV2): Promise<{ valid: boolean; keyFingerprint: string }> {
    if (signature.alg !== "ECDSA_P256_SHA256") {
      return { valid: false, keyFingerprint: "" };
    }

    const canonicalPayload = toCanonicalJson(payloadWithoutSignature);
    const payloadBytes = utf8Bytes(canonicalPayload);
    const digest = await sha256Bytes(payloadBytes);
    const digestEncoded = toBase64Url(digest);
    if (digestEncoded !== signature.payload_sha256) {
      return {
        valid: false,
        keyFingerprint: await this.fingerprintFromPublicKey(signature.public_key_jwk)
      };
    }

    const keyFingerprint = await this.fingerprintFromPublicKey(signature.public_key_jwk);
    let publicKey: CryptoKey;
    try {
      publicKey = await this.importPublicKey(signature.public_key_jwk);
    } catch {
      return {
        valid: false,
        keyFingerprint
      };
    }

    const isValid = await crypto.subtle.verify(
      {
        name: "ECDSA",
        hash: "SHA-256"
      },
      publicKey,
      toCryptoBufferSource(fromBase64Url(signature.signature_base64url)),
      toCryptoBufferSource(payloadBytes)
    );

    return {
      valid: isValid,
      keyFingerprint
    };
  }

  async assessSigner(signature: SignatureEnvelopeV2): Promise<{ keyFingerprint: string; trustStatus: SignerTrustStatus; trustReason: string }> {
    const fingerprint = await this.fingerprintFromPublicKey(signature.public_key_jwk);
    const selfFingerprint = await this.currentKeyFingerprint();
    const store = await this.loadTrustStore();

    const existing = store.signers[fingerprint] ?? {
      key_fingerprint: fingerprint,
      signer_key_id: signature.key_id,
      updated_at_utc: nowIso()
    };

    existing.signer_key_id = signature.key_id;
    existing.last_seen_at_utc = nowIso();
    store.signers[fingerprint] = existing;
    await this.saveTrustStore(store);

    const trustStatus = this.signerStatus(existing, selfFingerprint, fingerprint);
    return {
      keyFingerprint: fingerprint,
      trustStatus,
      trustReason: trustReasonForStatus(trustStatus)
    };
  }

  async listSigners(): Promise<SignerRecord[]> {
    const store = await this.loadTrustStore();
    const selfMaterial = await this.getOrCreateMaterial();
    const selfFingerprint = await this.fingerprintFromPublicKey(selfMaterial.public_key_jwk);

    if (!store.signers[selfFingerprint]) {
      store.signers[selfFingerprint] = {
        key_fingerprint: selfFingerprint,
        signer_key_id: selfMaterial.key_id,
        updated_at_utc: nowIso(),
        last_seen_at_utc: nowIso()
      };
      await this.saveTrustStore(store);
    }

    const rank = (status: SignerTrustStatus): number => {
      switch (status) {
        case "self":
          return 0;
        case "blocked":
          return 1;
        case "trusted":
          return 2;
        case "unknown":
        default:
          return 3;
      }
    };

    return Object.values(store.signers)
      .map((entry) => this.toSignerRecord(entry, selfFingerprint))
      .sort((a, b) => {
        const rankDiff = rank(a.trust_status) - rank(b.trust_status);
        if (rankDiff !== 0) {
          return rankDiff;
        }
        const aSeen = a.last_seen_at_utc ?? "";
        const bSeen = b.last_seen_at_utc ?? "";
        if (aSeen !== bSeen) {
          return bSeen.localeCompare(aSeen);
        }
        return a.key_fingerprint.localeCompare(b.key_fingerprint);
      });
  }

  async setSignerTrust(keyFingerprint: string, decision: SignerTrustDecision): Promise<SignerRecord> {
    const normalizedFingerprint = keyFingerprint.trim();
    if (!normalizedFingerprint) {
      throw new Error("Signer fingerprint is required.");
    }

    const selfFingerprint = await this.currentKeyFingerprint();
    const store = await this.loadTrustStore();
    const entry = store.signers[normalizedFingerprint] ?? {
      key_fingerprint: normalizedFingerprint,
      signer_key_id: "",
      updated_at_utc: nowIso()
    };

    if (normalizedFingerprint !== selfFingerprint) {
      if (decision === "none") {
        delete entry.decision;
      } else {
        entry.decision = decision;
      }
      entry.updated_at_utc = nowIso();
    }

    store.signers[normalizedFingerprint] = entry;
    await this.saveTrustStore(store);
    return this.toSignerRecord(entry, selfFingerprint);
  }
}

export function payloadWithoutSignature<T extends { signature: unknown }>(artifact: T): Omit<T, "signature"> {
  const { signature: _ignored, ...payload } = artifact;
  return payload;
}
