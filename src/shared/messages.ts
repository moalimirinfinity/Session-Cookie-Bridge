import type {
  ActiveTabContext,
  BridgeErrorCode,
  CopyFieldResult,
  DownloadResult,
  ExtractionBundle,
  ExportSessionResult,
  ImportMode,
  ImportPreset,
  ImportReport,
  ImportSessionResult,
  SignerRecord,
  SignerTrustDecision,
  VaultEntry,
  VaultOperationKind,
  ResponseEnvelope,
  VerifyArtifactResult
} from "./types";

export const MESSAGE_REQUEST_ACTIVE_TAB_CONTEXT = "REQUEST_ACTIVE_TAB_CONTEXT" as const;
export const MESSAGE_EXPORT_SESSION = "EXPORT_SESSION" as const;
export const MESSAGE_VERIFY_ARTIFACT = "VERIFY_ARTIFACT" as const;
export const MESSAGE_IMPORT_SESSION = "IMPORT_SESSION" as const;
export const MESSAGE_COPY_FIELD = "COPY_FIELD" as const;
export const MESSAGE_LIST_SIGNERS = "LIST_SIGNERS" as const;
export const MESSAGE_SET_SIGNER_TRUST = "SET_SIGNER_TRUST" as const;
export const MESSAGE_LIST_VAULT = "LIST_VAULT" as const;
export const MESSAGE_SAVE_TO_VAULT = "SAVE_TO_VAULT" as const;
export const MESSAGE_DELETE_VAULT_ENTRY = "DELETE_VAULT_ENTRY" as const;
export const MESSAGE_LIST_PRESETS = "LIST_PRESETS" as const;
export const MESSAGE_UPSERT_PRESET = "UPSERT_PRESET" as const;
export const MESSAGE_DELETE_PRESET = "DELETE_PRESET" as const;

// Deprecated legacy constants kept for one release cycle.
export const MESSAGE_REQUEST_PLATFORM_DATA = "REQUEST_PLATFORM_DATA" as const;
export const MESSAGE_COPY_COOKIE_HEADER = "COPY_COOKIE_HEADER" as const;
export const MESSAGE_COPY_ENV_BLOCK = "COPY_ENV_BLOCK" as const;
export const MESSAGE_EXPORT_JSON = "EXPORT_JSON" as const;
export const MESSAGE_COPY_CLI_SNIPPET = "COPY_CLI_SNIPPET" as const;

export type CopyFieldKey = "cookie_header" | "artifact_json" | "key_fingerprint";

export type BridgeMessageType =
  | typeof MESSAGE_REQUEST_ACTIVE_TAB_CONTEXT
  | typeof MESSAGE_EXPORT_SESSION
  | typeof MESSAGE_VERIFY_ARTIFACT
  | typeof MESSAGE_IMPORT_SESSION
  | typeof MESSAGE_COPY_FIELD
  | typeof MESSAGE_LIST_SIGNERS
  | typeof MESSAGE_SET_SIGNER_TRUST
  | typeof MESSAGE_LIST_VAULT
  | typeof MESSAGE_SAVE_TO_VAULT
  | typeof MESSAGE_DELETE_VAULT_ENTRY
  | typeof MESSAGE_LIST_PRESETS
  | typeof MESSAGE_UPSERT_PRESET
  | typeof MESSAGE_DELETE_PRESET
  | typeof MESSAGE_REQUEST_PLATFORM_DATA
  | typeof MESSAGE_COPY_COOKIE_HEADER
  | typeof MESSAGE_COPY_ENV_BLOCK
  | typeof MESSAGE_EXPORT_JSON
  | typeof MESSAGE_COPY_CLI_SNIPPET;

export interface RequestActiveTabContextMessage {
  type: typeof MESSAGE_REQUEST_ACTIVE_TAB_CONTEXT;
}

export interface ExportSessionMessage {
  type: typeof MESSAGE_EXPORT_SESSION;
  target_url: string;
}

export interface VerifyArtifactMessage {
  type: typeof MESSAGE_VERIFY_ARTIFACT;
  artifact_json: string;
}

export interface ImportSessionMessage {
  type: typeof MESSAGE_IMPORT_SESSION;
  artifact_json: string;
  import_mode?: ImportMode;
  target_url?: string;
  dry_run?: boolean;
}

export interface CopyFieldMessage {
  type: typeof MESSAGE_COPY_FIELD;
  field: CopyFieldKey;
  artifact_json: string;
}

export interface ListSignersMessage {
  type: typeof MESSAGE_LIST_SIGNERS;
}

export interface SetSignerTrustMessage {
  type: typeof MESSAGE_SET_SIGNER_TRUST;
  key_fingerprint: string;
  decision: SignerTrustDecision;
}

export interface ListVaultMessage {
  type: typeof MESSAGE_LIST_VAULT;
  query?: string;
}

export interface SaveToVaultMessage {
  type: typeof MESSAGE_SAVE_TO_VAULT;
  artifact_json: string;
  operation?: VaultOperationKind;
  import_mode?: ImportMode;
  target_url?: string;
  report?: ImportReport;
}

export interface DeleteVaultEntryMessage {
  type: typeof MESSAGE_DELETE_VAULT_ENTRY;
  id: string;
}

export interface ListPresetsMessage {
  type: typeof MESSAGE_LIST_PRESETS;
}

export interface UpsertPresetMessage {
  type: typeof MESSAGE_UPSERT_PRESET;
  host: string;
  default_mode: ImportMode;
  warning_hint?: string;
}

export interface DeletePresetMessage {
  type: typeof MESSAGE_DELETE_PRESET;
  id: string;
}

export interface RequestPlatformDataMessage {
  type: typeof MESSAGE_REQUEST_PLATFORM_DATA;
  platform_id: string;
}

export interface CopyCookieHeaderMessage {
  type: typeof MESSAGE_COPY_COOKIE_HEADER;
  platform_id: string;
  cookies: Record<string, string>;
}

export interface CopyEnvBlockMessage {
  type: typeof MESSAGE_COPY_ENV_BLOCK;
  platform_id: string;
  cookies: Record<string, string>;
}

export interface CopyCliSnippetMessage {
  type: typeof MESSAGE_COPY_CLI_SNIPPET;
  platform_id: string;
  cookies: Record<string, string>;
}

export interface ExportJsonMessage {
  type: typeof MESSAGE_EXPORT_JSON;
  platform_id: string;
  cookies: Record<string, string>;
}

export type BridgeRequestMessage =
  | RequestActiveTabContextMessage
  | ExportSessionMessage
  | VerifyArtifactMessage
  | ImportSessionMessage
  | CopyFieldMessage
  | ListSignersMessage
  | SetSignerTrustMessage
  | ListVaultMessage
  | SaveToVaultMessage
  | DeleteVaultEntryMessage
  | ListPresetsMessage
  | UpsertPresetMessage
  | DeletePresetMessage
  | RequestPlatformDataMessage
  | CopyCookieHeaderMessage
  | CopyEnvBlockMessage
  | CopyCliSnippetMessage
  | ExportJsonMessage;

export type ActiveTabContextResponse = ResponseEnvelope<ActiveTabContext>;
export type ExportSessionResponse = ResponseEnvelope<ExportSessionResult>;
export type VerifyArtifactResponse = ResponseEnvelope<VerifyArtifactResult>;
export type ImportSessionResponse = ResponseEnvelope<ImportSessionResult>;
export type CopyFieldResponse = ResponseEnvelope<CopyFieldResult>;
export type ExportJsonResponse = ResponseEnvelope<DownloadResult>;
export type LegacyPlatformDataResponse = ResponseEnvelope<ExtractionBundle>;
export type ListSignersResponse = ResponseEnvelope<{ signers: SignerRecord[] }>;
export type SetSignerTrustResponse = ResponseEnvelope<{ signer: SignerRecord }>;
export type ListVaultResponse = ResponseEnvelope<{ entries: VaultEntry[] }>;
export type SaveToVaultResponse = ResponseEnvelope<{ entry: VaultEntry }>;
export type DeleteVaultEntryResponse = ResponseEnvelope<{ id: string; deleted: boolean }>;
export type ListPresetsResponse = ResponseEnvelope<{ presets: ImportPreset[] }>;
export type UpsertPresetResponse = ResponseEnvelope<{ preset: ImportPreset }>;
export type DeletePresetResponse = ResponseEnvelope<{ id: string; deleted: boolean }>;

export type BridgeResponseMessage =
  | ActiveTabContextResponse
  | ExportSessionResponse
  | VerifyArtifactResponse
  | ImportSessionResponse
  | CopyFieldResponse
  | ListSignersResponse
  | SetSignerTrustResponse
  | ListVaultResponse
  | SaveToVaultResponse
  | DeleteVaultEntryResponse
  | ListPresetsResponse
  | UpsertPresetResponse
  | DeletePresetResponse
  | LegacyPlatformDataResponse
  | ExportJsonResponse;

const BRIDGE_ERROR_CODES: readonly BridgeErrorCode[] = [
  "INVALID_REQUEST",
  "UNKNOWN_PLATFORM",
  "PERMISSION_DENIED",
  "NOT_SIGNED_IN",
  "INVALID_ARTIFACT",
  "SIGNATURE_INVALID",
  "IMPORT_FAILED",
  "IMPORT_PARTIAL",
  "UNSUPPORTED_COOKIE",
  "API_FAILURE"
] as const;

function isBridgeErrorCode(value: unknown): value is BridgeErrorCode {
  return typeof value === "string" && BRIDGE_ERROR_CODES.includes(value as BridgeErrorCode);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCookieMap(value: unknown): value is Record<string, string> {
  if (!isObject(value)) {
    return false;
  }
  return Object.values(value).every((item) => typeof item === "string");
}

function isImportMode(value: unknown): value is ImportMode {
  return value === "rewrite_current_app" || value === "exact_replay";
}

function isSignerTrustDecision(value: unknown): value is SignerTrustDecision {
  return value === "trusted" || value === "blocked" || value === "none";
}

function isVaultOperationKind(value: unknown): value is VaultOperationKind {
  return value === "export" || value === "verify" || value === "import" || value === "dry_run";
}

function isImportReport(value: unknown): value is ImportReport {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.total === "number" &&
    typeof value.imported === "number" &&
    typeof value.failed === "number" &&
    typeof value.skipped === "number" &&
    Array.isArray(value.results)
  );
}

export function isBridgeRequestMessage(value: unknown): value is BridgeRequestMessage {
  if (!isObject(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case MESSAGE_REQUEST_ACTIVE_TAB_CONTEXT:
      return true;
    case MESSAGE_EXPORT_SESSION:
      return typeof value.target_url === "string";
    case MESSAGE_VERIFY_ARTIFACT:
    case MESSAGE_IMPORT_SESSION:
      return (
        typeof value.artifact_json === "string" &&
        (value.import_mode === undefined || isImportMode(value.import_mode)) &&
        (value.target_url === undefined || typeof value.target_url === "string") &&
        (value.dry_run === undefined || typeof value.dry_run === "boolean")
      );
    case MESSAGE_COPY_FIELD:
      return (
        typeof value.artifact_json === "string" &&
        (value.field === "cookie_header" || value.field === "artifact_json" || value.field === "key_fingerprint")
      );
    case MESSAGE_LIST_SIGNERS:
      return true;
    case MESSAGE_SET_SIGNER_TRUST:
      return typeof value.key_fingerprint === "string" && isSignerTrustDecision(value.decision);
    case MESSAGE_LIST_VAULT:
      return value.query === undefined || typeof value.query === "string";
    case MESSAGE_SAVE_TO_VAULT:
      return (
        typeof value.artifact_json === "string" &&
        (value.operation === undefined || isVaultOperationKind(value.operation)) &&
        (value.import_mode === undefined || isImportMode(value.import_mode)) &&
        (value.target_url === undefined || typeof value.target_url === "string") &&
        (value.report === undefined || isImportReport(value.report))
      );
    case MESSAGE_DELETE_VAULT_ENTRY:
      return typeof value.id === "string";
    case MESSAGE_LIST_PRESETS:
      return true;
    case MESSAGE_UPSERT_PRESET:
      return (
        typeof value.host === "string" &&
        isImportMode(value.default_mode) &&
        (value.warning_hint === undefined || typeof value.warning_hint === "string")
      );
    case MESSAGE_DELETE_PRESET:
      return typeof value.id === "string";
    case MESSAGE_REQUEST_PLATFORM_DATA:
      return typeof value.platform_id === "string";
    case MESSAGE_COPY_COOKIE_HEADER:
    case MESSAGE_COPY_ENV_BLOCK:
    case MESSAGE_COPY_CLI_SNIPPET:
    case MESSAGE_EXPORT_JSON:
      return typeof value.platform_id === "string" && isCookieMap(value.cookies);
    default:
      return false;
  }
}

export function isResponseEnvelope(value: unknown): value is BridgeResponseMessage {
  if (!isObject(value) || typeof value.ok !== "boolean") {
    return false;
  }

  if (value.ok) {
    return "data" in value;
  }

  if (!isObject(value.error)) {
    return false;
  }

  return typeof value.error.message === "string" && isBridgeErrorCode(value.error.code);
}
