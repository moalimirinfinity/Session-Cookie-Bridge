import type {
  BridgeErrorCode,
  CookieMap,
  DownloadResult,
  ExtractionBundle,
  ResponseEnvelope
} from "./types";

export const MESSAGE_REQUEST_PLATFORM_DATA = "REQUEST_PLATFORM_DATA" as const;
export const MESSAGE_COPY_COOKIE_HEADER = "COPY_COOKIE_HEADER" as const;
export const MESSAGE_COPY_ENV_BLOCK = "COPY_ENV_BLOCK" as const;
export const MESSAGE_EXPORT_JSON = "EXPORT_JSON" as const;
export const MESSAGE_COPY_CLI_SNIPPET = "COPY_CLI_SNIPPET" as const;

export type BridgeMessageType =
  | typeof MESSAGE_REQUEST_PLATFORM_DATA
  | typeof MESSAGE_COPY_COOKIE_HEADER
  | typeof MESSAGE_COPY_ENV_BLOCK
  | typeof MESSAGE_EXPORT_JSON
  | typeof MESSAGE_COPY_CLI_SNIPPET;

export interface RequestPlatformDataMessage {
  type: typeof MESSAGE_REQUEST_PLATFORM_DATA;
  platform_id: string;
}

export interface CopyCookieHeaderMessage {
  type: typeof MESSAGE_COPY_COOKIE_HEADER;
  platform_id: string;
  cookies: CookieMap;
}

export interface CopyEnvBlockMessage {
  type: typeof MESSAGE_COPY_ENV_BLOCK;
  platform_id: string;
  cookies: CookieMap;
}

export interface CopyCliSnippetMessage {
  type: typeof MESSAGE_COPY_CLI_SNIPPET;
  platform_id: string;
  cookies: CookieMap;
}

export interface ExportJsonMessage {
  type: typeof MESSAGE_EXPORT_JSON;
  platform_id: string;
  cookies: CookieMap;
}

export type BridgeRequestMessage =
  | RequestPlatformDataMessage
  | CopyCookieHeaderMessage
  | CopyEnvBlockMessage
  | CopyCliSnippetMessage
  | ExportJsonMessage;

export type RequestPlatformDataResponse = ResponseEnvelope<ExtractionBundle>;
export type CopyTextResponse = ResponseEnvelope<{ text: string }>;
export type ExportJsonResponse = ResponseEnvelope<DownloadResult>;

export type BridgeResponseMessage =
  | RequestPlatformDataResponse
  | CopyTextResponse
  | ExportJsonResponse;

const BRIDGE_ERROR_CODES: readonly BridgeErrorCode[] = [
  "INVALID_REQUEST",
  "UNKNOWN_PLATFORM",
  "PERMISSION_DENIED",
  "NOT_SIGNED_IN",
  "API_FAILURE"
] as const;

function isBridgeErrorCode(value: unknown): value is BridgeErrorCode {
  return typeof value === "string" && BRIDGE_ERROR_CODES.includes(value as BridgeErrorCode);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCookieMap(value: unknown): value is CookieMap {
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
  if (typeof value.error.code !== "string" || typeof value.error.message !== "string") {
    return false;
  }
  return isBridgeErrorCode(value.error.code);
}
