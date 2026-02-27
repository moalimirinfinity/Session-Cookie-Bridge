import type {
  ActiveTabContext,
  BridgeErrorCode,
  CopyFieldResult,
  DownloadResult,
  ExportSessionResult,
  ImportSessionResult,
  ResponseEnvelope,
  VerifyArtifactResult
} from "./types";

export const MESSAGE_REQUEST_ACTIVE_TAB_CONTEXT = "REQUEST_ACTIVE_TAB_CONTEXT" as const;
export const MESSAGE_EXPORT_SESSION = "EXPORT_SESSION" as const;
export const MESSAGE_VERIFY_ARTIFACT = "VERIFY_ARTIFACT" as const;
export const MESSAGE_IMPORT_SESSION = "IMPORT_SESSION" as const;
export const MESSAGE_COPY_FIELD = "COPY_FIELD" as const;

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
}

export interface CopyFieldMessage {
  type: typeof MESSAGE_COPY_FIELD;
  field: CopyFieldKey;
  artifact_json: string;
}

export interface RequestPlatformDataMessage {
  type: typeof MESSAGE_REQUEST_PLATFORM_DATA;
  platform_id: string;
}

export interface LegacyCopyMessage {
  type:
    | typeof MESSAGE_COPY_COOKIE_HEADER
    | typeof MESSAGE_COPY_ENV_BLOCK
    | typeof MESSAGE_COPY_CLI_SNIPPET
    | typeof MESSAGE_EXPORT_JSON;
  platform_id: string;
  cookies: Record<string, string>;
}

export type BridgeRequestMessage =
  | RequestActiveTabContextMessage
  | ExportSessionMessage
  | VerifyArtifactMessage
  | ImportSessionMessage
  | CopyFieldMessage
  | RequestPlatformDataMessage
  | LegacyCopyMessage;

export type ActiveTabContextResponse = ResponseEnvelope<ActiveTabContext>;
export type ExportSessionResponse = ResponseEnvelope<ExportSessionResult>;
export type VerifyArtifactResponse = ResponseEnvelope<VerifyArtifactResult>;
export type ImportSessionResponse = ResponseEnvelope<ImportSessionResult>;
export type CopyFieldResponse = ResponseEnvelope<CopyFieldResult>;
export type ExportJsonResponse = ResponseEnvelope<DownloadResult>;

export type BridgeResponseMessage =
  | ActiveTabContextResponse
  | ExportSessionResponse
  | VerifyArtifactResponse
  | ImportSessionResponse
  | CopyFieldResponse
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
      return typeof value.artifact_json === "string";
    case MESSAGE_COPY_FIELD:
      return (
        typeof value.artifact_json === "string" &&
        (value.field === "cookie_header" || value.field === "artifact_json" || value.field === "key_fingerprint")
      );
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
