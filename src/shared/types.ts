export type CookieMap = Record<string, string>;

export type BridgeErrorCode =
  | "INVALID_REQUEST"
  | "UNKNOWN_PLATFORM"
  | "PERMISSION_DENIED"
  | "NOT_SIGNED_IN"
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

export interface ExportPayloadV1 {
  schema_version: 1;
  platform: "medium";
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

export interface DownloadResult {
  download_id: number;
  filename: string;
}
