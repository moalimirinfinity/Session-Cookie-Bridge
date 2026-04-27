import { CookieService } from "../core/cookieService";
import { buildLegacyExtractionBundle, buildSignedSessionArtifact } from "../core/exportService";
import {
  cookieHeaderFromArtifact,
  importNormalizedArtifact,
  normalizeArtifactJson,
  verifyNormalizedArtifact
} from "../core/importService";
import { SigningService } from "../core/signingService";
import { WorkspaceService } from "../core/workspaceService";
import { getPlatformAdapter } from "../platforms/registry";
import {
  isBridgeRequestMessage,
  MESSAGE_COPY_CLI_SNIPPET,
  MESSAGE_COPY_COOKIE_HEADER,
  MESSAGE_COPY_ENV_BLOCK,
  MESSAGE_COPY_FIELD,
  MESSAGE_DELETE_PRESET,
  MESSAGE_DELETE_VAULT_ENTRY,
  MESSAGE_EXPORT_JSON,
  MESSAGE_EXPORT_SESSION,
  MESSAGE_IMPORT_SESSION,
  MESSAGE_LIST_PRESETS,
  MESSAGE_LIST_SIGNERS,
  MESSAGE_LIST_VAULT,
  MESSAGE_REQUEST_ACTIVE_TAB_CONTEXT,
  MESSAGE_REQUEST_PLATFORM_DATA,
  MESSAGE_SAVE_TO_VAULT,
  MESSAGE_SET_SIGNER_TRUST,
  MESSAGE_UPSERT_PRESET,
  MESSAGE_VERIFY_ARTIFACT,
  type BridgeRequestMessage,
  type BridgeResponseMessage
} from "../shared/messages";
import type { BridgeErrorCode, ImportMode, SaveVaultEntryInput, SessionArtifactV2, VaultOperationKind, ResponseEnvelope } from "../shared/types";

const cookieService = new CookieService();
const signingService = new SigningService();
const workspaceService = new WorkspaceService();

void signingService.ensureKeyHealth().then((health) => {
  if (!health.ok) {
    console.error(`[Session Cookie Bridge] signing key health check failed: ${health.error_message}`);
  }
});

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
  const blob = new Blob([jsonText], { type: "application/json;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const downloadId = await new Promise<number>((resolve, reject) => {
      chrome.downloads.download(
        {
          url: objectUrl,
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
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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

function parseImportMode(value: unknown): ImportMode {
  return value === "exact_replay" ? "exact_replay" : "rewrite_current_app";
}

async function getActiveTabHttpUrl(): Promise<string | null> {
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
    return null;
  }
  const parsed = parseHttpUrl(tab.url);
  return parsed?.href ?? null;
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

async function saveArtifactToVault(
  artifact: SessionArtifactV2,
  signerFingerprint: string,
  signerKeyId: string,
  trustStatus: "self" | "trusted" | "unknown" | "blocked",
  operation: VaultOperationKind,
  importMode?: ImportMode,
  targetUrl?: string,
  report?: SaveVaultEntryInput["report"]
): Promise<void> {
  const parsedSource = parseHttpUrl(artifact.source.target_url);
  const originHost = parsedSource?.hostname ?? "unknown";

  try {
    await workspaceService.saveVaultEntry({
      artifact_json: JSON.stringify(artifact, null, 2),
      artifact_id: artifact.artifact_id,
      origin_host: originHost,
      created_at_utc: artifact.created_at_utc,
      signer_fingerprint: signerFingerprint,
      signer_key_id: signerKeyId,
      trust_status: trustStatus,
      last_operation: operation,
      import_mode: importMode,
      target_url: targetUrl,
      report
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Session Cookie Bridge] vault save failed after ${operation}: ${message}`);
  }
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

  const trust = await signingService.assessSigner(artifact.data.artifact.signature);
  await saveArtifactToVault(
    artifact.data.artifact,
    artifact.data.key_fingerprint,
    artifact.data.artifact.signature.key_id,
    trust.trustStatus,
    "export"
  );

  return okResponse({
    artifact: artifact.data.artifact,
    key_fingerprint: artifact.data.key_fingerprint
  });
}

async function handleVerifyArtifact(artifactJson: string): Promise<BridgeResponseMessage> {
  const normalized = await normalizeArtifactJson(artifactJson, signingService);
  if (!normalized.ok) {
    return normalized;
  }

  const verification = await verifyNormalizedArtifact(normalized.data, signingService);
  if (!verification.ok) {
    return verification;
  }

  await saveArtifactToVault(
    normalized.data.artifact,
    verification.data.key_fingerprint,
    verification.data.signer_key_id,
    verification.data.trust_status,
    "verify"
  );

  return okResponse({
    valid: true,
    schema_version: normalized.data.schema_version,
    key_fingerprint: verification.data.key_fingerprint,
    cookie_count: normalized.data.artifact.cookies.length,
    legacy_converted: normalized.data.legacy_converted,
    trust_status: verification.data.trust_status,
    trust_reason: verification.data.trust_reason,
    signer_key_id: verification.data.signer_key_id
  });
}

async function requiredImportHostPatterns(
  mode: ImportMode,
  normalizedArtifact: SessionArtifactV2,
  targetUrl: string
): Promise<string[]> {
  if (mode === "exact_replay") {
    return cookieService.buildRequiredHostPatterns(normalizedArtifact.cookies);
  }
  return [cookieService.buildHostPatternForTargetUrl(targetUrl)];
}

async function handleImportSession(
  message: Extract<
    BridgeRequestMessage,
    {
      type: typeof MESSAGE_IMPORT_SESSION;
      artifact_json: string;
      import_mode?: ImportMode;
      target_url?: string;
      dry_run?: boolean;
    }
  >
): Promise<BridgeResponseMessage> {
  const normalized = await normalizeArtifactJson(message.artifact_json, signingService);
  if (!normalized.ok) {
    return normalized;
  }

  const mode = parseImportMode(message.import_mode);
  const activeTabUrl = await getActiveTabHttpUrl();
  const rawTargetUrl =
    typeof message.target_url === "string" && message.target_url.trim().length > 0
      ? message.target_url.trim()
      : mode === "rewrite_current_app"
        ? activeTabUrl ?? normalized.data.artifact.source.target_url
        : normalized.data.artifact.source.target_url;

  const parsedTarget = parseHttpUrl(rawTargetUrl);
  if (!parsedTarget) {
    return errorResponse("INVALID_REQUEST", `Invalid import target URL: ${rawTargetUrl}`);
  }

  const hostPatterns = await requiredImportHostPatterns(mode, normalized.data.artifact, parsedTarget.href);
  if (hostPatterns.length > 0) {
    const hasPermission = await cookieService.hasHostPermission(hostPatterns);
    if (!hasPermission) {
      return errorResponse("PERMISSION_DENIED", "Host permission is required for import.", {
        host_patterns: hostPatterns
      });
    }
  }

  const importResult = await importNormalizedArtifact(normalized.data, cookieService, signingService, {
    targetUrl: parsedTarget.href,
    importMode: mode,
    dryRun: message.dry_run === true
  });

  if (importResult.ok) {
    await saveArtifactToVault(
      normalized.data.artifact,
      importResult.data.key_fingerprint,
      normalized.data.artifact.signature.key_id,
      importResult.data.trust_status,
      importResult.data.dry_run ? "dry_run" : "import",
      importResult.data.mode_used,
      importResult.data.target_url_used,
      importResult.data.report
    );
    return importResult;
  }

  if (normalized.data.artifact && importResult.error.details?.key_fingerprint) {
    const trustStatus =
      importResult.error.details.trust_status === "self" ||
      importResult.error.details.trust_status === "trusted" ||
      importResult.error.details.trust_status === "unknown" ||
      importResult.error.details.trust_status === "blocked"
        ? importResult.error.details.trust_status
        : "unknown";

    await saveArtifactToVault(
      normalized.data.artifact,
      String(importResult.error.details.key_fingerprint),
      normalized.data.artifact.signature.key_id,
      trustStatus,
      message.dry_run === true ? "dry_run" : "import",
      mode,
      parsedTarget.href,
      importResult.error.details.report as SaveVaultEntryInput["report"] | undefined
    );
  }

  return importResult;
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

async function handleListSigners(): Promise<BridgeResponseMessage> {
  const signers = await signingService.listSigners();
  return okResponse({ signers });
}

async function handleSetSignerTrust(
  message: Extract<BridgeRequestMessage, { type: typeof MESSAGE_SET_SIGNER_TRUST; key_fingerprint: string; decision: "trusted" | "blocked" | "none" }>
): Promise<BridgeResponseMessage> {
  const signer = await signingService.setSignerTrust(message.key_fingerprint, message.decision);
  return okResponse({ signer });
}

async function handleListVault(query?: string): Promise<BridgeResponseMessage> {
  const entries = await workspaceService.listVaultEntries(query);
  return okResponse({ entries });
}

async function handleSaveToVault(
  message: Extract<
    BridgeRequestMessage,
    {
      type: typeof MESSAGE_SAVE_TO_VAULT;
      artifact_json: string;
      operation?: VaultOperationKind;
      import_mode?: ImportMode;
      target_url?: string;
      report?: SaveVaultEntryInput["report"];
    }
  >
): Promise<BridgeResponseMessage> {
  const normalized = await normalizeArtifactJson(message.artifact_json, signingService);
  if (!normalized.ok) {
    return normalized;
  }

  const verification = await verifyNormalizedArtifact(normalized.data, signingService);
  if (!verification.ok) {
    return verification;
  }

  const parsedSource = parseHttpUrl(normalized.data.artifact.source.target_url);
  const entry = await workspaceService.saveVaultEntry({
    artifact_json: JSON.stringify(normalized.data.artifact, null, 2),
    artifact_id: normalized.data.artifact.artifact_id,
    origin_host: parsedSource?.hostname ?? "unknown",
    created_at_utc: normalized.data.artifact.created_at_utc,
    signer_fingerprint: verification.data.key_fingerprint,
    signer_key_id: verification.data.signer_key_id,
    trust_status: verification.data.trust_status,
    last_operation: message.operation ?? "verify",
    import_mode: message.import_mode,
    target_url: message.target_url,
    report: message.report
  });

  return okResponse({ entry });
}

async function handleDeleteVaultEntry(id: string): Promise<BridgeResponseMessage> {
  const deleted = await workspaceService.deleteVaultEntry(id);
  return okResponse({ id, deleted });
}

async function handleListPresets(): Promise<BridgeResponseMessage> {
  const presets = await workspaceService.listPresets();
  return okResponse({ presets });
}

async function handleUpsertPreset(
  message: Extract<BridgeRequestMessage, { type: typeof MESSAGE_UPSERT_PRESET; host: string; default_mode: ImportMode; warning_hint?: string }>
): Promise<BridgeResponseMessage> {
  const preset = await workspaceService.upsertPreset(message.host, message.default_mode, message.warning_hint ?? "");
  return okResponse({ preset });
}

async function handleDeletePreset(id: string): Promise<BridgeResponseMessage> {
  const deleted = await workspaceService.deletePreset(id);
  return okResponse({ id, deleted });
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
  }

  return errorResponse("INVALID_REQUEST", "Unsupported legacy copy action.");
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

  const download = await downloadJsonFile(
    `${adapter.id}-legacy-cookies`,
    bundleResult.data.json_payload as unknown as Record<string, unknown>
  );
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
      return handleImportSession(message);
    case MESSAGE_COPY_FIELD:
      return handleCopyField(message.field, message.artifact_json);
    case MESSAGE_LIST_SIGNERS:
      return handleListSigners();
    case MESSAGE_SET_SIGNER_TRUST:
      return handleSetSignerTrust(message);
    case MESSAGE_LIST_VAULT:
      return handleListVault(message.query);
    case MESSAGE_SAVE_TO_VAULT:
      return handleSaveToVault(message);
    case MESSAGE_DELETE_VAULT_ENTRY:
      return handleDeleteVaultEntry(message.id);
    case MESSAGE_LIST_PRESETS:
      return handleListPresets();
    case MESSAGE_UPSERT_PRESET:
      return handleUpsertPreset(message);
    case MESSAGE_DELETE_PRESET:
      return handleDeletePreset(message.id);

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
