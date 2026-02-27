import { CookieService } from "../core/cookieService";
import { buildLegacyExtractionBundle, buildSignedSessionArtifact } from "../core/exportService";
import {
  cookieHeaderFromArtifact,
  importNormalizedArtifact,
  normalizeArtifactJson,
  verifyArtifactJson,
  verifyNormalizedArtifact
} from "../core/importService";
import { SigningService } from "../core/signingService";
import { getPlatformAdapter } from "../platforms/registry";
import {
  isBridgeRequestMessage,
  MESSAGE_COPY_CLI_SNIPPET,
  MESSAGE_COPY_COOKIE_HEADER,
  MESSAGE_COPY_ENV_BLOCK,
  MESSAGE_COPY_FIELD,
  MESSAGE_EXPORT_JSON,
  MESSAGE_EXPORT_SESSION,
  MESSAGE_IMPORT_SESSION,
  MESSAGE_REQUEST_ACTIVE_TAB_CONTEXT,
  MESSAGE_REQUEST_PLATFORM_DATA,
  MESSAGE_VERIFY_ARTIFACT,
  type BridgeRequestMessage,
  type BridgeResponseMessage
} from "../shared/messages";
import type { BridgeErrorCode, ResponseEnvelope } from "../shared/types";

const cookieService = new CookieService();
const signingService = new SigningService();

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

async function downloadJsonFile(prefix: string, payload: Record<string, unknown>): Promise<{ downloadId: number; filename: string }> {
  const timestamp = toTimestampLabel(new Date().toISOString());
  const filename = `session-cookie-bridge/${prefix}-${timestamp}.json`;
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

function parseHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function getActiveTabContext(): Promise<BridgeResponseMessage> {
  const tab = await new Promise<chrome.tabs.Tab | null>((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError || !tabs || tabs.length === 0) {
        resolve(null);
        return;
      }
      resolve(tabs[0] ?? null);
    });
  });

  if (!tab?.url) {
    return errorResponse("API_FAILURE", "Unable to determine the active tab URL.");
  }

  const parsed = parseHttpUrl(tab.url);
  if (!parsed) {
    return errorResponse("INVALID_REQUEST", "Active tab URL must be http(s).");
  }

  return okResponse({
    target_url: parsed.href,
    origin: parsed.origin,
    host_pattern: cookieService.buildHostPatternForTargetUrl(parsed.href),
    title: tab.title,
    tab_id: tab.id
  });
}

async function handleExportSession(targetUrl: string): Promise<BridgeResponseMessage> {
  const parsed = parseHttpUrl(targetUrl);
  if (!parsed) {
    return errorResponse("INVALID_REQUEST", "Target URL must be valid http(s).");
  }

  const hostPattern = cookieService.buildHostPatternForTargetUrl(parsed.href);
  const hasPermission = await cookieService.hasHostPermission([hostPattern]);
  if (!hasPermission) {
    return errorResponse("PERMISSION_DENIED", "Host permission is required for export.", {
      host_patterns: [hostPattern]
    });
  }

  const cookies = await cookieService.getCookiesForTargetUrl(parsed.href);
  const artifact = await buildSignedSessionArtifact(parsed.href, cookies, signingService);
  if (!artifact.ok) {
    return artifact;
  }

  return okResponse({
    artifact: artifact.data.artifact,
    key_fingerprint: artifact.data.key_fingerprint
  });
}

async function handleVerifyArtifact(artifactJson: string): Promise<BridgeResponseMessage> {
  return verifyArtifactJson(artifactJson, signingService);
}

async function handleImportSession(artifactJson: string): Promise<BridgeResponseMessage> {
  const normalized = await normalizeArtifactJson(artifactJson, signingService);
  if (!normalized.ok) {
    return normalized;
  }

  const verification = await verifyNormalizedArtifact(normalized.data, signingService);
  if (!verification.ok) {
    return verification;
  }

  const hostPatterns = cookieService.buildRequiredHostPatterns(normalized.data.artifact.cookies);
  if (hostPatterns.length > 0) {
    const hasPermission = await cookieService.hasHostPermission(hostPatterns);
    if (!hasPermission) {
      return errorResponse("PERMISSION_DENIED", "Host permission is required for import.", {
        host_patterns: hostPatterns
      });
    }
  }

  return importNormalizedArtifact(normalized.data, cookieService, signingService);
}

async function handleCopyField(field: "cookie_header" | "artifact_json" | "key_fingerprint", artifactJson: string): Promise<BridgeResponseMessage> {
  const normalized = await normalizeArtifactJson(artifactJson, signingService);
  if (!normalized.ok) {
    return normalized;
  }

  switch (field) {
    case "cookie_header":
      return okResponse({ text: cookieHeaderFromArtifact(normalized.data.artifact) });
    case "artifact_json":
      return okResponse({ text: JSON.stringify(normalized.data.artifact, null, 2) });
    case "key_fingerprint": {
      const verified = await verifyNormalizedArtifact(normalized.data, signingService);
      if (!verified.ok) {
        return verified;
      }
      return okResponse({ text: verified.data.key_fingerprint });
    }
    default:
      return errorResponse("INVALID_REQUEST", `Unsupported copy field: ${field}`);
  }
}

async function handleLegacyPlatformExtraction(platformId: string): Promise<BridgeResponseMessage> {
  const adapter = getPlatformAdapter(platformId);
  if (!adapter) {
    return errorResponse("UNKNOWN_PLATFORM", `Unknown platform: ${platformId}`);
  }

  const hasPermission = await cookieService.hasHostPermission(adapter.hostPatterns);
  if (!hasPermission) {
    return errorResponse("PERMISSION_DENIED", `Host permission denied for ${adapter.label}.`, {
      host_patterns: adapter.hostPatterns
    });
  }

  const cookies = await cookieService.getCookiesForUrl(adapter.cookieUrl);
  return buildLegacyExtractionBundle(adapter, cookies);
}

function handleLegacyCopyAction(
  message: Extract<
    BridgeRequestMessage,
    {
      type:
        | typeof MESSAGE_COPY_COOKIE_HEADER
        | typeof MESSAGE_COPY_ENV_BLOCK
        | typeof MESSAGE_COPY_CLI_SNIPPET;
      cookies: Record<string, string>;
      platform_id: string;
    }
  >
): BridgeResponseMessage {
  const adapter = getPlatformAdapter(message.platform_id);
  if (!adapter) {
    return errorResponse("UNKNOWN_PLATFORM", `Unknown platform: ${message.platform_id}`);
  }

  const bundleResult = buildLegacyExtractionBundle(adapter, message.cookies);
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
      return errorResponse("INVALID_REQUEST", `Unsupported legacy copy action: ${message.type}`);
  }
}

async function handleLegacyExportJson(
  message: Extract<BridgeRequestMessage, { type: typeof MESSAGE_EXPORT_JSON; cookies: Record<string, string>; platform_id: string }>
): Promise<BridgeResponseMessage> {
  const adapter = getPlatformAdapter(message.platform_id);
  if (!adapter) {
    return errorResponse("UNKNOWN_PLATFORM", `Unknown platform: ${message.platform_id}`);
  }

  const bundleResult = buildLegacyExtractionBundle(adapter, message.cookies);
  if (!bundleResult.ok) {
    return bundleResult;
  }

  const download = await downloadJsonFile(`${adapter.id}-legacy-cookies`, bundleResult.data.json_payload as Record<string, unknown>);
  return okResponse({
    download_id: download.downloadId,
    filename: download.filename
  });
}

async function routeMessage(message: BridgeRequestMessage): Promise<BridgeResponseMessage> {
  switch (message.type) {
    case MESSAGE_REQUEST_ACTIVE_TAB_CONTEXT:
      return getActiveTabContext();
    case MESSAGE_EXPORT_SESSION:
      return handleExportSession(message.target_url);
    case MESSAGE_VERIFY_ARTIFACT:
      return handleVerifyArtifact(message.artifact_json);
    case MESSAGE_IMPORT_SESSION:
      return handleImportSession(message.artifact_json);
    case MESSAGE_COPY_FIELD:
      return handleCopyField(message.field, message.artifact_json);

    // Legacy compatibility shims.
    case MESSAGE_REQUEST_PLATFORM_DATA:
      return handleLegacyPlatformExtraction(message.platform_id);
    case MESSAGE_COPY_COOKIE_HEADER:
    case MESSAGE_COPY_ENV_BLOCK:
    case MESSAGE_COPY_CLI_SNIPPET:
      return handleLegacyCopyAction(message);
    case MESSAGE_EXPORT_JSON:
      return handleLegacyExportJson(message);
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
