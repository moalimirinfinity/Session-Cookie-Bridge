import { listPlatformAdapters } from "../platforms/registry";
import {
  isResponseEnvelope,
  MESSAGE_COPY_CLI_SNIPPET,
  MESSAGE_COPY_COOKIE_HEADER,
  MESSAGE_COPY_ENV_BLOCK,
  MESSAGE_EXPORT_JSON,
  MESSAGE_REQUEST_PLATFORM_DATA,
  type BridgeRequestMessage,
  type BridgeResponseMessage
} from "../shared/messages";
import type { BridgeError, BridgeErrorCode, ExtractionBundle } from "../shared/types";

type StatusKind = "info" | "success" | "warning" | "error";
type CopyMessageType =
  | typeof MESSAGE_COPY_COOKIE_HEADER
  | typeof MESSAGE_COPY_ENV_BLOCK
  | typeof MESSAGE_COPY_CLI_SNIPPET;

const platformSelect = mustElement<HTMLSelectElement>("platformSelect");
const extractButton = mustElement<HTMLButtonElement>("extractButton");
const statusPanel = mustElement<HTMLElement>("statusPanel");
const healthPanel = mustElement<HTMLElement>("healthPanel");
const requiredSummary = mustElement<HTMLElement>("requiredSummary");
const requiredList = mustElement<HTMLUListElement>("requiredList");
const resultPanel = mustElement<HTMLElement>("resultPanel");
const metaLine = mustElement<HTMLElement>("metaLine");
const cookieHeaderPreview = mustElement<HTMLTextAreaElement>("cookieHeaderPreview");
const envBlockPreview = mustElement<HTMLTextAreaElement>("envBlockPreview");
const cliSnippetPreview = mustElement<HTMLTextAreaElement>("cliSnippetPreview");
const copyHeaderButton = mustElement<HTMLButtonElement>("copyHeaderButton");
const copyEnvButton = mustElement<HTMLButtonElement>("copyEnvButton");
const copyCliButton = mustElement<HTMLButtonElement>("copyCliButton");
const exportJsonButton = mustElement<HTMLButtonElement>("exportJsonButton");

const adapters = listPlatformAdapters();
const adapterById = new Map(adapters.map((adapter) => [adapter.id, adapter]));

let inMemoryExtraction: ExtractionBundle | null = null;
let busy = false;

function mustElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required popup element: #${id}`);
  }
  return element as T;
}

function errorEnvelope(code: BridgeErrorCode, message: string): BridgeResponseMessage {
  return {
    ok: false,
    error: { code, message }
  };
}

function requestHostPermission(origins: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.permissions.request({ origins }, (granted) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        resolve(false);
        return;
      }
      resolve(Boolean(granted));
    });
  });
}

function sendBridgeMessage(message: BridgeRequestMessage): Promise<BridgeResponseMessage> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        resolve(errorEnvelope("API_FAILURE", runtimeError.message || "Runtime messaging failed."));
        return;
      }
      if (!isResponseEnvelope(response)) {
        resolve(errorEnvelope("API_FAILURE", "Invalid response envelope from background worker."));
        return;
      }
      resolve(response);
    });
  });
}

function setStatus(kind: StatusKind, message: string): void {
  statusPanel.className = `panel status ${kind}`;
  statusPanel.textContent = message;
}

function setBusy(nextBusy: boolean): void {
  busy = nextBusy;
  extractButton.disabled = busy;
  platformSelect.disabled = busy;
  const disabled = busy || inMemoryExtraction === null;
  copyHeaderButton.disabled = disabled;
  copyEnvButton.disabled = disabled;
  copyCliButton.disabled = disabled;
  exportJsonButton.disabled = disabled;
}

function clearResultPreview(): void {
  inMemoryExtraction = null;
  resultPanel.classList.add("hidden");
  metaLine.textContent = "";
  cookieHeaderPreview.value = "";
  envBlockPreview.value = "";
  cliSnippetPreview.value = "";
  setBusy(busy);
}

function setRequiredSummary(presentCount: number, totalCount: number): void {
  requiredSummary.textContent = `${presentCount}/${totalCount} present`;
  requiredSummary.className = "summary";

  if (totalCount === 0) {
    requiredSummary.classList.add("neutral");
    return;
  }

  requiredSummary.classList.add(presentCount === totalCount ? "ok" : "missing");
}

function renderRequiredHealth(platformId: string, requiredPresent: Record<string, boolean>): void {
  requiredList.innerHTML = "";
  const adapter = adapterById.get(platformId);
  const requiredNames = adapter?.requiredCookies ?? Object.keys(requiredPresent).sort();
  let presentCount = 0;

  for (const name of requiredNames) {
    const present = Boolean(requiredPresent[name]);
    if (present) {
      presentCount += 1;
    }
    const item = document.createElement("li");
    item.className = "required-item";

    const label = document.createElement("span");
    label.textContent = name;

    const badge = document.createElement("span");
    badge.className = `badge ${present ? "ok" : "missing"}`;
    badge.textContent = present ? "present" : "missing";

    item.append(label, badge);
    requiredList.appendChild(item);
  }

  setRequiredSummary(presentCount, requiredNames.length);
  healthPanel.classList.remove("hidden");
}

function hideRequiredHealth(): void {
  requiredList.innerHTML = "";
  setRequiredSummary(0, 0);
  healthPanel.classList.add("hidden");
}

function toHealthDetails(details: unknown): Record<string, boolean> | null {
  if (!details || typeof details !== "object") {
    return null;
  }
  const maybeRecord = (details as Record<string, unknown>).required_present;
  if (!maybeRecord || typeof maybeRecord !== "object") {
    return null;
  }

  const parsed: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(maybeRecord as Record<string, unknown>)) {
    if (typeof value !== "boolean") {
      return null;
    }
    parsed[key] = value;
  }
  return parsed;
}

function describeError(error: BridgeError): string {
  switch (error.code) {
    case "NOT_SIGNED_IN": {
      const details = error.details ?? {};
      const missing = Array.isArray(details.missing_required)
        ? details.missing_required.filter((entry): entry is string => typeof entry === "string")
        : [];
      if (missing.length > 0) {
        return `Not signed in for Medium. Missing required cookies: ${missing.join(", ")}.`;
      }
      return "Not signed in for Medium. Required cookies are missing.";
    }
    case "PERMISSION_DENIED":
      return "Permission denied. Allow medium.com host access and try again.";
    case "UNKNOWN_PLATFORM":
      return "Unsupported platform selection.";
    case "INVALID_REQUEST":
      return "Invalid request sent to background worker.";
    case "API_FAILURE":
      return `Background API failure: ${error.message}`;
    default:
      return error.message;
  }
}

function renderExtraction(bundle: ExtractionBundle): void {
  const dateLabel = new Date(bundle.created_at_utc).toLocaleString();
  metaLine.textContent = `Platform: ${bundle.platform_label} | Captured: ${dateLabel} | Cookies: ${Object.keys(bundle.cookies).length}`;
  cookieHeaderPreview.value = bundle.cookie_header;
  envBlockPreview.value = bundle.env_block;
  cliSnippetPreview.value = bundle.cli_import_snippet;
  renderRequiredHealth(bundle.platform_id, bundle.required_present);
  resultPanel.classList.remove("hidden");
}

function buildCopyMessage(type: CopyMessageType, extraction: ExtractionBundle): BridgeRequestMessage {
  return {
    type,
    platform_id: extraction.platform_id,
    cookies: extraction.cookies
  };
}

async function handleExtract(): Promise<void> {
  const platformId = platformSelect.value;
  if (!platformId) {
    setStatus("warning", "Select a platform first.");
    return;
  }

  const adapter = adapterById.get(platformId);
  if (!adapter) {
    setStatus("error", "Unsupported platform selection.");
    return;
  }

  setBusy(true);
  clearResultPreview();
  hideRequiredHealth();

  setStatus("info", "Requesting host permission for medium.com...");
  const permissionGranted = await requestHostPermission(adapter.hostPatterns);
  if (!permissionGranted) {
    setStatus("error", "Permission denied. Allow medium.com host access and try again.");
    setBusy(false);
    return;
  }

  setStatus("info", "Extracting cookies...");

  const response = await sendBridgeMessage({
    type: MESSAGE_REQUEST_PLATFORM_DATA,
    platform_id: platformId
  });

  if (!response.ok) {
    const requiredHealth = toHealthDetails(response.error.details);
    if (requiredHealth) {
      renderRequiredHealth(platformId, requiredHealth);
    }
    setStatus(response.error.code === "NOT_SIGNED_IN" ? "warning" : "error", describeError(response.error));
    setBusy(false);
    return;
  }

  inMemoryExtraction = response.data;
  renderExtraction(response.data);
  setStatus("success", "Extraction complete. You can now copy or export artifacts.");
  setBusy(false);
}

async function handleCopy(type: CopyMessageType, successText: string): Promise<void> {
  if (!inMemoryExtraction) {
    setStatus("warning", "Run extraction first.");
    return;
  }

  setBusy(true);
  const response = await sendBridgeMessage(buildCopyMessage(type, inMemoryExtraction));
  if (!response.ok) {
    setStatus("error", describeError(response.error));
    setBusy(false);
    return;
  }

  const text = (response.data as { text?: unknown }).text;
  if (typeof text !== "string") {
    setStatus("error", "Copy payload was missing expected text content.");
    setBusy(false);
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setStatus("success", successText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus("error", `Clipboard write failed: ${message}`);
  }

  setBusy(false);
}

async function handleExportJson(): Promise<void> {
  if (!inMemoryExtraction) {
    setStatus("warning", "Run extraction first.");
    return;
  }

  setBusy(true);
  const response = await sendBridgeMessage({
    type: MESSAGE_EXPORT_JSON,
    platform_id: inMemoryExtraction.platform_id,
    cookies: inMemoryExtraction.cookies
  });

  if (!response.ok) {
    setStatus("error", describeError(response.error));
    setBusy(false);
    return;
  }

  const payload = response.data as { filename?: unknown };
  if (typeof payload.filename === "string") {
    setStatus("success", `JSON exported as ${payload.filename}`);
  } else {
    setStatus("success", "JSON export completed.");
  }

  setBusy(false);
}

function initPlatformOptions(): void {
  for (const adapter of adapters) {
    const option = document.createElement("option");
    option.value = adapter.id;
    option.textContent = adapter.label;
    option.disabled = adapter.id !== "medium";
    platformSelect.appendChild(option);
  }

  const defaultAdapter = adapters.find((adapter) => adapter.id === "medium") ?? adapters[0];
  if (defaultAdapter) {
    platformSelect.value = defaultAdapter.id;
  }
}

function bindEvents(): void {
  extractButton.addEventListener("click", () => {
    void handleExtract();
  });

  copyHeaderButton.addEventListener("click", () => {
    void handleCopy(MESSAGE_COPY_COOKIE_HEADER, "Cookie header copied to clipboard.");
  });

  copyEnvButton.addEventListener("click", () => {
    void handleCopy(MESSAGE_COPY_ENV_BLOCK, ".env block copied to clipboard.");
  });

  copyCliButton.addEventListener("click", () => {
    void handleCopy(MESSAGE_COPY_CLI_SNIPPET, "CLI snippet copied to clipboard.");
  });

  exportJsonButton.addEventListener("click", () => {
    void handleExportJson();
  });

  window.addEventListener("unload", () => {
    inMemoryExtraction = null;
  });
}

function init(): void {
  initPlatformOptions();
  bindEvents();
  setBusy(false);
}

init();
