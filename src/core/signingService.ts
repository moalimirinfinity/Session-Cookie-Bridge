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

function toBase64Url(bytes: Uint8Array): string {
  const base64 =
    typeof btoa === "function"
      ? btoa(String.fromCharCode(...bytes))
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
  const digest = await crypto.subtle.digest("SHA-256", input);
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
    if (!this.storage) {
      return this.keyCache;
    }

    return new Promise((resolve, reject) => {
      this.storage.get(this.storageKey, (items) => {
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
    if (!this.storage) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.storage.set({ [this.storageKey]: material }, () => {
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

  private async getOrCreateMaterial(): Promise<SigningKeyMaterial> {
    if (this.keyCache) {
      return this.keyCache;
    }
    const existing = await this.loadKeyMaterial();
    if (existing) {
      this.keyCache = existing;
      return existing;
    }
    const created = await this.createKeyMaterial();
    await this.saveKeyMaterial(created);
    return created;
  }

  async fingerprintFromPublicKey(publicKeyJwk: JsonWebKey): Promise<string> {
    const digest = await digestCanonical(publicKeyJwk);
    return toHex(digest).slice(0, 24);
  }

  async signPayload(payloadWithoutSignature: unknown): Promise<{ signature: SignatureEnvelopeV2; keyFingerprint: string }> {
    const material = await this.getOrCreateMaterial();
    const canonicalPayload = toCanonicalJson(payloadWithoutSignature);
    const payloadBytes = utf8Bytes(canonicalPayload);
    const payloadDigest = await sha256Bytes(payloadBytes);
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      material.private_key_jwk,
      {
        name: "ECDSA",
        namedCurve: "P-256"
      },
      false,
      ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign(
      {
        name: "ECDSA",
        hash: "SHA-256"
      },
      privateKey,
      payloadBytes
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

    const publicKey = await crypto.subtle.importKey(
      "jwk",
      signature.public_key_jwk,
      {
        name: "ECDSA",
        namedCurve: "P-256"
      },
      false,
      ["verify"]
    );

    const isValid = await crypto.subtle.verify(
      {
        name: "ECDSA",
        hash: "SHA-256"
      },
      publicKey,
      fromBase64Url(signature.signature_base64url),
      payloadBytes
    );

    return {
      valid: isValid,
      keyFingerprint: await this.fingerprintFromPublicKey(signature.public_key_jwk)
    };
  }
}

export function payloadWithoutSignature<T extends { signature: unknown }>(artifact: T): Omit<T, "signature"> {
  const { signature: _ignored, ...payload } = artifact;
  return payload;
}
