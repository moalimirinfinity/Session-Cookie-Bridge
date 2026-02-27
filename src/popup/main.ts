import {
  isResponseEnvelope,
  MESSAGE_COPY_FIELD,
  MESSAGE_EXPORT_SESSION,
  MESSAGE_IMPORT_SESSION,
  MESSAGE_REQUEST_ACTIVE_TAB_CONTEXT,
  MESSAGE_VERIFY_ARTIFACT,
  type BridgeRequestMessage,
  type BridgeResponseMessage
} from "../shared/messages";
import type { BridgeError, BridgeErrorCode, ImportReport } from "../shared/types";

type StatusKind = "info" | "success" | "warning" | "error";
type TabId = "export" | "import";

const tabExportButton = mustElement<HTMLButtonElement>("tabExportButton");
const tabImportButton = mustElement<HTMLButtonElement>("tabImportButton");
const exportPanel = mustElement<HTMLElement>("exportPanel");
const importPanel = mustElement<HTMLElement>("importPanel");
const statusPanel = mustElement<HTMLElement>("statusPanel");

const targetUrlInput = mustElement<HTMLInputElement>("targetUrlInput");
const detectTabButton = mustElement<HTMLButtonElement>("detectTabButton");
const requestPermissionButton = mustElement<HTMLButtonElement>("requestPermissionButton");
const exportSessionButton = mustElement<HTMLButtonElement>("exportSessionButton");
const copyHeaderButton = mustElement<HTMLButtonElement>("copyHeaderButton");
const copyArtifactButton = mustElement<HTMLButtonElement>("copyArtifactButton");
const downloadArtifactButton = mustElement<HTMLButtonElement>("downloadArtifactButton");
const cookieHeaderPreview = mustElement<HTMLTextAreaElement>("cookieHeaderPreview");
const fingerprintPreview = mustElement<HTMLInputElement>("fingerprintPreview");
const artifactPreview = mustElement<HTMLTextAreaElement>("artifactPreview");

const artifactFileInput = mustElement<HTMLInputElement>("artifactFileInput");
const artifactInput = mustElement<HTMLTextAreaElement>("artifactInput");
const verifyArtifactButton = mustElement<HTMLButtonElement>("verifyArtifactButton");
const importSessionButton = mustElement<HTMLButtonElement>("importSessionButton");
const verifyPanel = mustElement<HTMLElement>("verifyPanel");
const verifySummary = mustElement<HTMLElement>("verifySummary");
const importReportPanel = mustElement<HTMLElement>("importReportPanel");
const importSummary = mustElement<HTMLElement>("importSummary");
const importResultsList = mustElement<HTMLUListElement>("importResultsList");

let busy = false;

function mustElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing popup element: #${id}`);
  }
  return element as T;
}

function errorEnvelope(code: BridgeErrorCode, message: string): BridgeResponseMessage {
  return {
    ok: false,
    error: { code, message }
  };
}

function setStatus(kind: StatusKind, message: string): void {
  statusPanel.className = `panel status ${kind}`;
  statusPanel.textContent = message;
}

function setBusy(nextBusy: boolean): void {
  busy = nextBusy;
  const controls: Array<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement> = [
    targetUrlInput,
    detectTabButton,
    requestPermissionButton,
    exportSessionButton,
    copyHeaderButton,
    copyArtifactButton,
    downloadArtifactButton,
    artifactFileInput,
    artifactInput,
    verifyArtifactButton,
    importSessionButton
  ];
  for (const control of controls) {
    control.disabled = nextBusy;
  }
}

function showTab(tab: TabId): void {
  const exportActive = tab === "export";
  tabExportButton.classList.toggle("active", exportActive);
  tabImportButton.classList.toggle("active", !exportActive);
  exportPanel.classList.toggle("hidden", !exportActive);
  importPanel.classList.toggle("hidden", exportActive);
}

function parseTargetUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function hostPatternForUrl(targetUrl: URL): string {
  return `${targetUrl.protocol}//${targetUrl.hostname}/*`;
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
        resolve(errorEnvelope("API_FAILURE", runtimeError.message || "Runtime message failure."));
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

function describeError(error: BridgeError): string {
  switch (error.code) {
    case "PERMISSION_DENIED":
      return "Permission denied. Grant host access and retry.";
    case "INVALID_REQUEST":
      return "Invalid request payload.";
    case "INVALID_ARTIFACT":
      return `Artifact invalid: ${error.message}`;
    case "SIGNATURE_INVALID":
      return `Signature verification failed: ${error.message}`;
    case "IMPORT_PARTIAL":
      return "Import completed with partial failures.";
    case "IMPORT_FAILED":
      return "Import failed. No cookies were imported.";
    case "UNSUPPORTED_COOKIE":
      return `Unsupported cookie constraint: ${error.message}`;
    case "API_FAILURE":
      return `Background API failure: ${error.message}`;
    case "UNKNOWN_PLATFORM":
    case "NOT_SIGNED_IN":
      return error.message;
    default:
      return error.message;
  }
}

async function writeClipboard(text: string, successMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    setStatus("success", successMessage);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus("error", `Clipboard write failed: ${message}`);
  }
}

function clearExportPreview(): void {
  cookieHeaderPreview.value = "";
  fingerprintPreview.value = "";
  artifactPreview.value = "";
}

async function handleDetectActiveTab(): Promise<void> {
  setBusy(true);
  const response = await sendBridgeMessage({ type: MESSAGE_REQUEST_ACTIVE_TAB_CONTEXT });
  if (!response.ok) {
    setStatus("error", describeError(response.error));
    setBusy(false);
    return;
  }

  const data = response.data as { target_url?: unknown };
  if (typeof data.target_url === "string") {
    targetUrlInput.value = data.target_url;
    setStatus("info", "Active tab URL loaded.");
  } else {
    setStatus("warning", "Active tab URL unavailable.");
  }
  setBusy(false);
}

async function handleRequestPermission(): Promise<void> {
  const parsed = parseTargetUrl(targetUrlInput.value);
  if (!parsed) {
    setStatus("warning", "Enter a valid http(s) target URL first.");
    return;
  }

  setBusy(true);
  const granted = await requestHostPermission([hostPatternForUrl(parsed)]);
  setStatus(granted ? "success" : "error", granted ? "Host permission granted." : "Permission denied.");
  setBusy(false);
}

async function handleExportSession(): Promise<void> {
  const parsed = parseTargetUrl(targetUrlInput.value);
  if (!parsed) {
    setStatus("warning", "Enter a valid http(s) target URL first.");
    return;
  }

  setBusy(true);
  clearExportPreview();
  const hostPattern = hostPatternForUrl(parsed);
  const permissionGranted = await requestHostPermission([hostPattern]);
  if (!permissionGranted) {
    setStatus("error", "Permission denied for target host.");
    setBusy(false);
    return;
  }

  let response = await sendBridgeMessage({
    type: MESSAGE_EXPORT_SESSION,
    target_url: parsed.href
  });

  if (!response.ok && response.error.code === "PERMISSION_DENIED") {
    const hostPatterns = Array.isArray(response.error.details?.host_patterns)
      ? response.error.details.host_patterns.filter((value): value is string => typeof value === "string")
      : [];
    if (hostPatterns.length > 0) {
      const granted = await requestHostPermission(hostPatterns);
      if (granted) {
        response = await sendBridgeMessage({
          type: MESSAGE_EXPORT_SESSION,
          target_url: parsed.href
        });
      }
    }
  }

  if (!response.ok) {
    setStatus("error", describeError(response.error));
    setBusy(false);
    return;
  }

  const payload = response.data as {
    artifact?: { derived?: { cookie_header?: unknown } };
    key_fingerprint?: unknown;
  };
  const artifactText = JSON.stringify(payload.artifact ?? {}, null, 2);
  artifactPreview.value = artifactText;
  cookieHeaderPreview.value =
    typeof payload.artifact?.derived?.cookie_header === "string" ? payload.artifact.derived.cookie_header : "";
  fingerprintPreview.value = typeof payload.key_fingerprint === "string" ? payload.key_fingerprint : "";
  setStatus("success", "Signed session artifact exported.");
  setBusy(false);
}

async function handleCopyHeader(): Promise<void> {
  if (!artifactPreview.value.trim()) {
    setStatus("warning", "Export a session first.");
    return;
  }

  setBusy(true);
  const response = await sendBridgeMessage({
    type: MESSAGE_COPY_FIELD,
    field: "cookie_header",
    artifact_json: artifactPreview.value
  });

  if (!response.ok) {
    setStatus("error", describeError(response.error));
    setBusy(false);
    return;
  }

  const text = (response.data as { text?: unknown }).text;
  if (typeof text !== "string") {
    setStatus("error", "Copy field response is missing text.");
    setBusy(false);
    return;
  }

  await writeClipboard(text, "Cookie header copied.");
  setBusy(false);
}

async function handleCopyArtifact(): Promise<void> {
  if (!artifactPreview.value.trim()) {
    setStatus("warning", "No artifact to copy.");
    return;
  }
  setBusy(true);
  await writeClipboard(artifactPreview.value, "Signed artifact JSON copied.");
  setBusy(false);
}

function timestampLabel(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

async function handleDownloadArtifact(): Promise<void> {
  if (!artifactPreview.value.trim()) {
    setStatus("warning", "No artifact to download.");
    return;
  }

  setBusy(true);
  try {
    const parsed = JSON.parse(artifactPreview.value) as { source?: { origin?: string }; created_at_utc?: string };
    const host = parsed.source?.origin ? new URL(parsed.source.origin).hostname : "session";
    const timestamp = parsed.created_at_utc ? timestampLabel(parsed.created_at_utc) : timestampLabel(new Date().toISOString());
    const filename = `session-cookie-bridge/${host}-signed-session-${timestamp}.json`;
    const url = `data:application/json;charset=utf-8,${encodeURIComponent(artifactPreview.value)}`;
    chrome.downloads.download(
      {
        url,
        filename,
        saveAs: true,
        conflictAction: "uniquify"
      },
      (downloadId) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError || typeof downloadId !== "number") {
          setStatus("error", runtimeError?.message || "Download failed.");
          setBusy(false);
          return;
        }
        setStatus("success", `Artifact downloaded as ${filename}`);
        setBusy(false);
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus("error", `Failed to parse artifact JSON: ${message}`);
    setBusy(false);
  }
}

async function handleArtifactFileSelect(): Promise<void> {
  const file = artifactFileInput.files?.[0];
  if (!file) {
    return;
  }
  const content = await file.text();
  artifactInput.value = content;
  setStatus("info", `Loaded artifact file: ${file.name}`);
}

function toImportReport(value: unknown): ImportReport | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const report = value as Partial<ImportReport>;
  if (
    typeof report.total !== "number" ||
    typeof report.imported !== "number" ||
    typeof report.failed !== "number" ||
    typeof report.skipped !== "number" ||
    !Array.isArray(report.results)
  ) {
    return null;
  }
  return report as ImportReport;
}

function renderImportReport(report: ImportReport): void {
  importReportPanel.classList.remove("hidden");
  importSummary.textContent = `Total ${report.total} | Imported ${report.imported} | Failed ${report.failed} | Skipped ${report.skipped}`;
  importResultsList.innerHTML = "";

  for (const result of report.results) {
    const item = document.createElement("li");
    item.className = "result-item";
    const text = document.createElement("span");
    text.textContent = `${result.name} @ ${result.domain}${result.path}${result.reason ? ` (${result.reason})` : ""}`;
    const status = document.createElement("span");
    status.className = `status-pill ${result.status}`;
    status.textContent = result.status;
    item.append(text, status);
    importResultsList.appendChild(item);
  }
}

function clearImportPanels(): void {
  verifyPanel.classList.add("hidden");
  importReportPanel.classList.add("hidden");
  verifySummary.textContent = "";
  importSummary.textContent = "";
  importResultsList.innerHTML = "";
}

async function handleVerifyArtifact(): Promise<void> {
  const json = artifactInput.value.trim();
  if (!json) {
    setStatus("warning", "Paste artifact JSON first.");
    return;
  }

  setBusy(true);
  const response = await sendBridgeMessage({
    type: MESSAGE_VERIFY_ARTIFACT,
    artifact_json: json
  });

  if (!response.ok) {
    setStatus("error", describeError(response.error));
    const report = toImportReport(response.error.details?.report);
    if (report) {
      renderImportReport(report);
    }
    setBusy(false);
    return;
  }

  const payload = response.data as {
    valid?: unknown;
    schema_version?: unknown;
    key_fingerprint?: unknown;
    cookie_count?: unknown;
    legacy_converted?: unknown;
  };
  verifyPanel.classList.remove("hidden");
  verifySummary.textContent = [
    payload.valid === true ? "Valid signature" : "Invalid signature",
    typeof payload.schema_version === "number" ? `Schema v${payload.schema_version}` : "",
    typeof payload.cookie_count === "number" ? `${payload.cookie_count} cookies` : "",
    typeof payload.key_fingerprint === "string" ? `Signer ${payload.key_fingerprint}` : "",
    payload.legacy_converted === true ? "legacy-converted" : ""
  ]
    .filter(Boolean)
    .join(" | ");

  setStatus("success", "Artifact verification succeeded.");
  setBusy(false);
}

async function handleImportSession(): Promise<void> {
  const json = artifactInput.value.trim();
  if (!json) {
    setStatus("warning", "Paste artifact JSON first.");
    return;
  }

  setBusy(true);
  clearImportPanels();

  let response = await sendBridgeMessage({
    type: MESSAGE_IMPORT_SESSION,
    artifact_json: json
  });

  if (!response.ok && response.error.code === "PERMISSION_DENIED") {
    const hostPatterns = Array.isArray(response.error.details?.host_patterns)
      ? response.error.details.host_patterns.filter((value): value is string => typeof value === "string")
      : [];

    if (hostPatterns.length > 0) {
      const granted = await requestHostPermission(hostPatterns);
      if (granted) {
        response = await sendBridgeMessage({
          type: MESSAGE_IMPORT_SESSION,
          artifact_json: json
        });
      }
    }
  }

  if (!response.ok) {
    setStatus(response.error.code === "IMPORT_PARTIAL" ? "warning" : "error", describeError(response.error));
    const report = toImportReport(response.error.details?.report);
    if (report) {
      renderImportReport(report);
    }
    setBusy(false);
    return;
  }

  const payload = response.data as { report?: unknown; key_fingerprint?: unknown; legacy_converted?: unknown };
  const report = toImportReport(payload.report);
  if (report) {
    renderImportReport(report);
  }

  verifyPanel.classList.remove("hidden");
  verifySummary.textContent = [
    typeof payload.key_fingerprint === "string" ? `Signer ${payload.key_fingerprint}` : "",
    payload.legacy_converted === true ? "legacy-converted" : "native-v2"
  ]
    .filter(Boolean)
    .join(" | ");

  setStatus("success", "Session import completed.");
  setBusy(false);
}

function bindEvents(): void {
  tabExportButton.addEventListener("click", () => {
    showTab("export");
  });
  tabImportButton.addEventListener("click", () => {
    showTab("import");
  });

  detectTabButton.addEventListener("click", () => {
    void handleDetectActiveTab();
  });
  requestPermissionButton.addEventListener("click", () => {
    void handleRequestPermission();
  });
  exportSessionButton.addEventListener("click", () => {
    void handleExportSession();
  });
  copyHeaderButton.addEventListener("click", () => {
    void handleCopyHeader();
  });
  copyArtifactButton.addEventListener("click", () => {
    void handleCopyArtifact();
  });
  downloadArtifactButton.addEventListener("click", () => {
    void handleDownloadArtifact();
  });

  artifactFileInput.addEventListener("change", () => {
    void handleArtifactFileSelect();
  });
  verifyArtifactButton.addEventListener("click", () => {
    void handleVerifyArtifact();
  });
  importSessionButton.addEventListener("click", () => {
    void handleImportSession();
  });
}

function init(): void {
  bindEvents();
  setBusy(false);
  clearImportPanels();
  showTab("export");
  void handleDetectActiveTab();
}

init();
