export type CookieMap = Record<string, string>;

export type BridgeErrorCode =
  | "INVALID_REQUEST"
  | "UNKNOWN_PLATFORM"
  | "PERMISSION_DENIED"
  | "NOT_SIGNED_IN"
  | "INVALID_ARTIFACT"
  | "SIGNATURE_INVALID"
  | "IMPORT_FAILED"
  | "IMPORT_PARTIAL"
  | "UNSUPPORTED_COOKIE"
  | "API_FAILURE";

export interface BridgeError {
  code: BridgeErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type ResponseEnvelope<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: BridgeError;
    };

export type CookieSameSiteV2 = "no_restriction" | "lax" | "strict" | "unspecified";

export interface CookiePartitionKeyV2 {
  topLevelSite?: string;
  hasCrossSiteAncestor?: boolean;
}

export interface CookieRecordV2 {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: CookieSameSiteV2;
  expirationDate?: number;
  hostOnly: boolean;
  session: boolean;
  storeId: string;
  partitionKey?: CookiePartitionKeyV2;
}

export interface SignatureEnvelopeV2 {
  alg: "ECDSA_P256_SHA256";
  key_id: string;
  public_key_jwk: JsonWebKey;
  payload_sha256: string;
  signature_base64url: string;
  signed_at_utc: string;
}

export interface SessionArtifactSourceV2 {
  target_url: string;
  origin: string;
  captured_by_extension_version: string;
}

export interface SessionArtifactDerivedV2 {
  cookie_header: string;
  cookie_count: number;
}

export interface SessionArtifactPayloadV2 {
  schema_version: 2;
  artifact_id: string;
  created_at_utc: string;
  source: SessionArtifactSourceV2;
  cookies: CookieRecordV2[];
  derived: SessionArtifactDerivedV2;
}

export interface SessionArtifactV2 extends SessionArtifactPayloadV2 {
  signature: SignatureEnvelopeV2;
}

export interface ActiveTabContext {
  target_url: string;
  origin: string;
  host_pattern: string;
  title?: string;
  tab_id?: number;
}

export interface ExportSessionResult {
  artifact: SessionArtifactV2;
  key_fingerprint: string;
}

export interface VerifyArtifactResult {
  valid: boolean;
  schema_version: 1 | 2;
  key_fingerprint: string;
  cookie_count: number;
  legacy_converted: boolean;
}

export type ImportCookieStatus = "imported" | "failed" | "skipped";

export interface ImportCookieResult {
  name: string;
  domain: string;
  path: string;
  status: ImportCookieStatus;
  reason?: string;
}

export interface ImportReport {
  total: number;
  imported: number;
  failed: number;
  skipped: number;
  results: ImportCookieResult[];
}

export interface ImportSessionResult {
  key_fingerprint: string;
  legacy_converted: boolean;
  report: ImportReport;
}

export interface DownloadResult {
  download_id: number;
  filename: string;
}

export interface CopyFieldResult {
  text: string;
}

// Legacy schema v1 kept for one release-cycle compatibility.
export interface ExportPayloadV1 {
  schema_version: 1;
  platform: string;
  created_at_utc: string;
  cookie_header: string;
  cookies: CookieMap;
  required_present: Record<string, boolean>;
  env_block: string;
  cli_import_snippet: string;
}

export interface ExtractionBundle {
  platform_id: string;
  platform_label: string;
  created_at_utc: string;
  cookie_header: string;
  cookies: CookieMap;
  required_present: Record<string, boolean>;
  missing_required: string[];
  env_block: string;
  cli_import_snippet: string;
  json_payload: ExportPayloadV1;
}
