import { CookieService } from "../core/cookieService";
import { buildExtractionBundle } from "../core/exportService";
import { getPlatformAdapter } from "../platforms/registry";
import {
  isBridgeRequestMessage,
  MESSAGE_COPY_CLI_SNIPPET,
  MESSAGE_COPY_COOKIE_HEADER,
  MESSAGE_COPY_ENV_BLOCK,
  MESSAGE_EXPORT_JSON,
  MESSAGE_REQUEST_PLATFORM_DATA,
  type BridgeRequestMessage,
  type BridgeResponseMessage
} from "../shared/messages";
import type { BridgeErrorCode, ResponseEnvelope } from "../shared/types";

const cookieService = new CookieService();

function errorResponse(
  code: BridgeErrorCode,
  message: string,
  details?: Record<string, unknown>
): BridgeResponseMessage {
  return {
    ok: false,
    error: {
      code,
      message,
      details
    }
  };
}

function okResponse<T>(data: T): ResponseEnvelope<T> {
  return {
    ok: true,
    data
  };
}

function toTimestampLabel(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

async function downloadJsonFile(platformId: string, payload: Record<string, unknown>): Promise<{ downloadId: number; filename: string }> {
  const timestamp = toTimestampLabel(new Date().toISOString());
  const filename = `session-cookie-bridge/${platformId}-cookies-${timestamp}.json`;
  const jsonText = JSON.stringify(payload, null, 2);
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(jsonText)}`;

  const downloadId = await new Promise<number>((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename,
        saveAs: true,
        conflictAction: "uniquify"
      },
      (resultId) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        if (typeof resultId !== "number") {
          reject(new Error("Download failed without an id."));
          return;
        }
        resolve(resultId);
      }
    );
  });

  return { downloadId, filename };
}

async function handlePlatformExtraction(platformId: string): Promise<BridgeResponseMessage> {
  const adapter = getPlatformAdapter(platformId);
  if (!adapter) {
    return errorResponse("UNKNOWN_PLATFORM", `Unknown platform: ${platformId}`);
  }

  const hasPermission = await cookieService.hasHostPermission(adapter.hostPatterns);
  if (!hasPermission) {
    return errorResponse(
      "PERMISSION_DENIED",
      `Host permission denied for ${adapter.label}.`,
      { host_patterns: adapter.hostPatterns }
    );
  }

  const cookies = await cookieService.getCookiesForUrl(adapter.cookieUrl);
  return buildExtractionBundle(adapter, cookies);
}

function handleCopyAction(message: Extract<BridgeRequestMessage, { cookies: Record<string, string> }>): BridgeResponseMessage {
  const adapter = getPlatformAdapter(message.platform_id);
  if (!adapter) {
    return errorResponse("UNKNOWN_PLATFORM", `Unknown platform: ${message.platform_id}`);
  }

  const bundleResult = buildExtractionBundle(adapter, message.cookies);
  if (!bundleResult.ok) {
    return bundleResult;
  }

  switch (message.type) {
    case MESSAGE_COPY_COOKIE_HEADER:
      return okResponse({ text: bundleResult.data.cookie_header });
    case MESSAGE_COPY_ENV_BLOCK:
      return okResponse({ text: bundleResult.data.env_block });
    case MESSAGE_COPY_CLI_SNIPPET:
      return okResponse({ text: bundleResult.data.cli_import_snippet });
    default:
      return errorResponse("INVALID_REQUEST", `Unsupported copy action: ${message.type}`);
  }
}

async function handleExportJson(message: Extract<BridgeRequestMessage, { type: typeof MESSAGE_EXPORT_JSON }>): Promise<BridgeResponseMessage> {
  const adapter = getPlatformAdapter(message.platform_id);
  if (!adapter) {
    return errorResponse("UNKNOWN_PLATFORM", `Unknown platform: ${message.platform_id}`);
  }

  const bundleResult = buildExtractionBundle(adapter, message.cookies);
  if (!bundleResult.ok) {
    return bundleResult;
  }

  const download = await downloadJsonFile(adapter.id, bundleResult.data.json_payload as Record<string, unknown>);
  return okResponse({
    download_id: download.downloadId,
    filename: download.filename
  });
}

async function routeMessage(message: BridgeRequestMessage): Promise<BridgeResponseMessage> {
  switch (message.type) {
    case MESSAGE_REQUEST_PLATFORM_DATA:
      return handlePlatformExtraction(message.platform_id);
    case MESSAGE_COPY_COOKIE_HEADER:
    case MESSAGE_COPY_ENV_BLOCK:
    case MESSAGE_COPY_CLI_SNIPPET:
      return handleCopyAction(message);
    case MESSAGE_EXPORT_JSON:
      return handleExportJson(message);
    default:
      return errorResponse("INVALID_REQUEST", `Unknown message type: ${(message as { type?: string }).type ?? ""}`);
  }
}

chrome.runtime.onMessage.addListener((rawMessage: unknown, _sender, sendResponse) => {
  if (!isBridgeRequestMessage(rawMessage)) {
    sendResponse(errorResponse("INVALID_REQUEST", "Invalid message payload."));
    return false;
  }

  void routeMessage(rawMessage)
    .then((response) => sendResponse(response))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      sendResponse(errorResponse("API_FAILURE", message));
    });

  return true;
});
