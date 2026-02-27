import { toCanonicalJson, utf8Bytes } from "./canonicalJson";
import type { SignatureEnvelopeV2 } from "../shared/types";

const DEFAULT_STORAGE_KEY = "signing.v1";

interface SigningKeyMaterial {
  key_id: string;
  public_key_jwk: JsonWebKey;
  private_key_jwk: JsonWebKey;
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

  private keyCache: SigningKeyMaterial | null = null;

  constructor(storage: ChromeStorageLike | null = null, storageKey = DEFAULT_STORAGE_KEY) {
    if (storage) {
      this.storage = storage;
    } else if (typeof chrome !== "undefined" && chrome.storage?.local) {
      this.storage = chrome.storage.local as ChromeStorageLike;
    } else {
      this.storage = null;
    }
    this.runtime = getRuntime();
    this.storageKey = storageKey;
  }

  private async loadKeyMaterial(): Promise<SigningKeyMaterial | null> {
    const storage = this.storage;
    if (!storage) {
      return this.keyCache;
    }

    return new Promise((resolve, reject) => {
      storage.get(this.storageKey, (items) => {
        const runtimeError = runtimeErrorMessage(this.runtime);
        if (runtimeError) {
          reject(new Error(runtimeError));
          return;
        }
        const raw = items[this.storageKey];
        if (!raw || typeof raw !== "object") {
          resolve(null);
          return;
        }
        const maybe = raw as Partial<SigningKeyMaterial>;
        if (!maybe.key_id || !maybe.public_key_jwk || !maybe.private_key_jwk) {
          resolve(null);
          return;
        }
        resolve({
          key_id: maybe.key_id,
          public_key_jwk: maybe.public_key_jwk,
          private_key_jwk: maybe.private_key_jwk
        });
      });
    });
  }

  private async saveKeyMaterial(material: SigningKeyMaterial): Promise<void> {
    this.keyCache = material;
    const storage = this.storage;
    if (!storage) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      storage.set({ [this.storageKey]: material }, () => {
        const runtimeError = runtimeErrorMessage(this.runtime);
        if (runtimeError) {
          reject(new Error(runtimeError));
          return;
        }
        resolve();
      });
    });
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

    // If stored keys are corrupted/incompatible, rotate to a fresh pair.
    const created = await this.createKeyMaterial();
    await this.saveKeyMaterial(created);
    return created;
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
      // Recover from invalid persisted key material.
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
      signed_at_utc: new Date().toISOString()
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
}

export function payloadWithoutSignature<T extends { signature: unknown }>(artifact: T): Omit<T, "signature"> {
  const { signature: _ignored, ...payload } = artifact;
  return payload;
}
