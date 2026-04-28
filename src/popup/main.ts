import {
  isResponseEnvelope,
  MESSAGE_COPY_FIELD,
  MESSAGE_DELETE_PRESET,
  MESSAGE_DELETE_VAULT_ENTRY,
  MESSAGE_EXPORT_SESSION,
  MESSAGE_IMPORT_SESSION,
  MESSAGE_LIST_PRESETS,
  MESSAGE_LIST_SIGNERS,
  MESSAGE_LIST_VAULT,
  MESSAGE_REQUEST_ACTIVE_TAB_CONTEXT,
  MESSAGE_SET_SIGNER_TRUST,
  MESSAGE_UPSERT_PRESET,
  MESSAGE_VERIFY_ARTIFACT,
  type BridgeRequestMessage,
  type BridgeResponseMessage
} from "../shared/messages";
import type {
  BridgeError,
  BridgeErrorCode,
  ImportMode,
  ImportPreset,
  ImportReport,
  SignerRecord,
  SignerTrustStatus,
  VaultEntry
} from "../shared/types";

type StatusKind = "info" | "success" | "warning" | "error";
type TabId = "export" | "import" | "workspace";
type IconId =
  | "check"
  | "copy"
  | "download"
  | "export"
  | "file"
  | "import"
  | "play"
  | "refresh"
  | "save"
  | "search"
  | "shield"
  | "target"
  | "trash"
  | "vault";

const tabExportButton = mustElement<HTMLButtonElement>("tabExportButton");
const tabImportButton = mustElement<HTMLButtonElement>("tabImportButton");
const tabWorkspaceButton = mustElement<HTMLButtonElement>("tabWorkspaceButton");
const exportPanel = mustElement<HTMLElement>("exportPanel");
const importPanel = mustElement<HTMLElement>("importPanel");
const workspacePanel = mustElement<HTMLElement>("workspacePanel");
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
const importModeSelect = mustElement<HTMLSelectElement>("importModeSelect");
const importTargetUrlInput = mustElement<HTMLInputElement>("importTargetUrlInput");
const dryRunCheckbox = mustElement<HTMLInputElement>("dryRunCheckbox");
const verifyArtifactButton = mustElement<HTMLButtonElement>("verifyArtifactButton");
const importSessionButton = mustElement<HTMLButtonElement>("importSessionButton");
const verifyPanel = mustElement<HTMLElement>("verifyPanel");
const verifySummary = mustElement<HTMLElement>("verifySummary");
const importReportPanel = mustElement<HTMLElement>("importReportPanel");
const importSummary = mustElement<HTMLElement>("importSummary");
const importResultsList = mustElement<HTMLUListElement>("importResultsList");

const refreshVaultButton = mustElement<HTMLButtonElement>("refreshVaultButton");
const searchVaultButton = mustElement<HTMLButtonElement>("searchVaultButton");
const vaultSearchInput = mustElement<HTMLInputElement>("vaultSearchInput");
const vaultList = mustElement<HTMLUListElement>("vaultList");

const refreshSignersButton = mustElement<HTMLButtonElement>("refreshSignersButton");
const signerList = mustElement<HTMLUListElement>("signerList");

const refreshPresetsButton = mustElement<HTMLButtonElement>("refreshPresetsButton");
const presetHostInput = mustElement<HTMLInputElement>("presetHostInput");
const presetModeSelect = mustElement<HTMLSelectElement>("presetModeSelect");
const presetWarningInput = mustElement<HTMLInputElement>("presetWarningInput");
const savePresetButton = mustElement<HTMLButtonElement>("savePresetButton");
const presetList = mustElement<HTMLUListElement>("presetList");

let busy = false;
let hasExportArtifact = false;
let presetCache: ImportPreset[] = [];

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

function createIcon(iconId: IconId): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  svg.classList.add("icon");
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", `#icon-${iconId}`);
  svg.appendChild(use);
  return svg;
}

function setButtonContent(button: HTMLButtonElement, iconId: IconId, label: string): void {
  const labelElement = document.createElement("span");
  labelElement.className = "button-label";
  labelElement.textContent = label;
  button.replaceChildren(createIcon(iconId), labelElement);
}

function setupIconography(): void {
  setButtonContent(tabExportButton, "export", "Export");
  setButtonContent(tabImportButton, "import", "Import");
  setButtonContent(tabWorkspaceButton, "vault", "Workspace");
  setButtonContent(detectTabButton, "target", "Active Tab");
  setButtonContent(requestPermissionButton, "shield", "Permission");
  setButtonContent(exportSessionButton, "export", "Export");
  setButtonContent(copyHeaderButton, "copy", "Header");
  setButtonContent(copyArtifactButton, "copy", "JSON");
  setButtonContent(downloadArtifactButton, "download", "Download");
  setButtonContent(verifyArtifactButton, "check", "Verify");
  setButtonContent(importSessionButton, "import", "Import");
  setButtonContent(refreshVaultButton, "refresh", "Refresh");
  setButtonContent(searchVaultButton, "search", "Search");
  setButtonContent(refreshSignersButton, "refresh", "Refresh");
  setButtonContent(refreshPresetsButton, "refresh", "Refresh");
  setButtonContent(savePresetButton, "save", "Save");
}

function setStatus(kind: StatusKind, message: string): void {
  statusPanel.className = `panel status ${kind}`;
  statusPanel.textContent = message;
}

function parseTargetUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function refreshControlStates(): void {
  const controls: Array<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement> = [
    targetUrlInput,
    detectTabButton,
    requestPermissionButton,
    exportSessionButton,
    artifactFileInput,
    artifactInput,
    importModeSelect,
    importTargetUrlInput,
    dryRunCheckbox,
    refreshVaultButton,
    searchVaultButton,
    vaultSearchInput,
    refreshSignersButton,
    refreshPresetsButton,
    presetHostInput,
    presetModeSelect,
    presetWarningInput,
    savePresetButton
  ];

  for (const control of controls) {
    control.disabled = busy;
  }

  const hasArtifactInput = artifactInput.value.trim().length > 0;
  copyHeaderButton.disabled = busy || !hasExportArtifact;
  copyArtifactButton.disabled = busy || !hasExportArtifact;
  downloadArtifactButton.disabled = busy || !hasExportArtifact;
  verifyArtifactButton.disabled = busy || !hasArtifactInput;
  importSessionButton.disabled = busy || !hasArtifactInput;
}

function setBusy(nextBusy: boolean): void {
  busy = nextBusy;
  refreshControlStates();
}

function showTab(tab: TabId): void {
  const exportActive = tab === "export";
  const importActive = tab === "import";
  const workspaceActive = tab === "workspace";

  tabExportButton.classList.toggle("active", exportActive);
  tabImportButton.classList.toggle("active", importActive);
  tabWorkspaceButton.classList.toggle("active", workspaceActive);

  exportPanel.classList.toggle("hidden", !exportActive);
  importPanel.classList.toggle("hidden", !importActive);
  workspacePanel.classList.toggle("hidden", !workspaceActive);

  tabExportButton.setAttribute("aria-selected", String(exportActive));
  tabImportButton.setAttribute("aria-selected", String(importActive));
  tabWorkspaceButton.setAttribute("aria-selected", String(workspaceActive));
  tabExportButton.tabIndex = exportActive ? 0 : -1;
  tabImportButton.tabIndex = importActive ? 0 : -1;
  tabWorkspaceButton.tabIndex = workspaceActive ? 0 : -1;

  exportPanel.setAttribute("aria-hidden", String(!exportActive));
  importPanel.setAttribute("aria-hidden", String(!importActive));
  workspacePanel.setAttribute("aria-hidden", String(!workspaceActive));
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
      return `Invalid request: ${error.message}`;
    case "INVALID_ARTIFACT":
      return `Artifact invalid: ${error.message}`;
    case "SIGNATURE_INVALID":
      return `Signature or trust failed: ${error.message}`;
    case "IMPORT_PARTIAL":
      return "Import completed with partial failures.";
    case "IMPORT_FAILED":
      return "Import failed. No cookies were imported.";
    case "NOT_SIGNED_IN":
      return "No exportable cookies found. Make sure you are signed in on target site.";
    case "UNSUPPORTED_COOKIE":
      return `Unsupported cookie constraint: ${error.message}`;
    case "API_FAILURE":
      return `Background API failure: ${error.message}`;
    case "UNKNOWN_PLATFORM":
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
  hasExportArtifact = false;
  cookieHeaderPreview.value = "";
  fingerprintPreview.value = "";
  artifactPreview.value = "";
  refreshControlStates();
}

function parseModeValue(value: string): ImportMode {
  return value === "exact_replay" ? "exact_replay" : "rewrite_current_app";
}

function modeLabel(mode: ImportMode): string {
  return mode === "exact_replay" ? "Exact replay" : "Rewrite current app";
}

function operationLabel(operation: VaultEntry["last_operation"]): string {
  switch (operation) {
    case "export":
      return "Export";
    case "verify":
      return "Verify";
    case "dry_run":
      return "Dry run";
    case "import":
    default:
      return "Import";
  }
}

function formatUtcLabel(value?: string): string {
  if (!value) {
    return "Unknown time";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function createTrustPill(status: SignerTrustStatus): HTMLSpanElement {
  const pill = document.createElement("span");
  pill.className = `trust-pill trust-${status}`;
  pill.textContent = status;
  return pill;
}

function createEmptyWorkspaceItem(text: string): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "workspace-item";
  const info = document.createElement("div");
  info.className = "workspace-copy workspace-empty";
  info.textContent = text;
  item.appendChild(info);
  return item;
}

function applyPresetForHost(hostname: string, silent = false): void {
  const preset = presetCache.find((item) => item.host === hostname.toLowerCase());
  if (!preset) {
    return;
  }

  importModeSelect.value = preset.default_mode;
  importTargetUrlInput.value = `https://${preset.host}/`;
  if (!silent) {
    if (preset.warning_hint) {
      setStatus("warning", `Preset for ${preset.host}: ${preset.warning_hint}`);
    } else {
      setStatus("info", `Applied preset for ${preset.host}.`);
    }
  }
}

async function handleDetectActiveTab(silent = false): Promise<void> {
  setBusy(true);
  const response = await sendBridgeMessage({ type: MESSAGE_REQUEST_ACTIVE_TAB_CONTEXT });
  if (!response.ok) {
    if (!silent) {
      setStatus("error", describeError(response.error));
    }
    setBusy(false);
    return;
  }

  const data = response.data as { target_url?: unknown };
  if (typeof data.target_url === "string") {
    targetUrlInput.value = data.target_url;
    const parsed = parseTargetUrl(data.target_url);
    if (parsed) {
      applyPresetForHost(parsed.hostname, true);
    }
    if (!silent) {
      setStatus("info", "Active tab URL loaded.");
    }
  } else if (!silent) {
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
  targetUrlInput.value = parsed.href;

  setBusy(true);
  const granted = await requestHostPermission([hostPatternForUrl(parsed)]);
  setStatus(granted ? "success" : "error", granted ? "Host permission granted." : "Permission denied.");
  setBusy(false);
}

async function refreshWorkspaceData(silent = true): Promise<void> {
  await Promise.all([loadVault(vaultSearchInput.value, silent), loadSigners(silent), loadPresets(silent)]);
}

async function handleExportSession(): Promise<void> {
  const parsed = parseTargetUrl(targetUrlInput.value);
  if (!parsed) {
    setStatus("warning", "Enter a valid http(s) target URL first.");
    return;
  }
  targetUrlInput.value = parsed.href;

  setBusy(true);
  clearExportPreview();

  const permissionGranted = await requestHostPermission([hostPatternForUrl(parsed)]);
  if (!permissionGranted) {
    setStatus("error", "Permission denied for target host.");
    setBusy(false);
    return;
  }

  const response = await sendBridgeMessage({
    type: MESSAGE_EXPORT_SESSION,
    target_url: parsed.href
  });

  if (!response.ok) {
    setStatus("error", describeError(response.error));
    setBusy(false);
    return;
  }

  const payload = response.data as {
    artifact?: { derived?: { cookie_header?: unknown } };
    key_fingerprint?: unknown;
  };

  artifactPreview.value = JSON.stringify(payload.artifact ?? {}, null, 2);
  cookieHeaderPreview.value =
    typeof payload.artifact?.derived?.cookie_header === "string" ? payload.artifact.derived.cookie_header : "";
  fingerprintPreview.value = typeof payload.key_fingerprint === "string" ? payload.key_fingerprint : "";
  hasExportArtifact = true;
  setStatus("success", "Signed session artifact exported.");
  setBusy(false);

  await refreshWorkspaceData(true);
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
    const blob = new Blob([artifactPreview.value], { type: "application/json;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);

    chrome.downloads.download(
      {
        url: objectUrl,
        filename,
        saveAs: true,
        conflictAction: "uniquify"
      },
      (downloadId) => {
        URL.revokeObjectURL(objectUrl);
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
    refreshControlStates();
    return;
  }
  const content = await file.text();
  artifactInput.value = content;
  refreshControlStates();
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
    setBusy(false);
    return;
  }

  const payload = response.data as {
    valid?: unknown;
    schema_version?: unknown;
    key_fingerprint?: unknown;
    cookie_count?: unknown;
    legacy_converted?: unknown;
    trust_status?: unknown;
    trust_reason?: unknown;
    signer_key_id?: unknown;
  };

  verifyPanel.classList.remove("hidden");
  verifySummary.textContent = [
    payload.valid === true ? "Valid signature" : "Invalid signature",
    typeof payload.schema_version === "number" ? `Schema v${payload.schema_version}` : "",
    typeof payload.cookie_count === "number" ? `${payload.cookie_count} cookies` : "",
    typeof payload.key_fingerprint === "string" ? `Signer ${payload.key_fingerprint}` : "",
    typeof payload.trust_status === "string" ? `Trust ${payload.trust_status}` : "",
    typeof payload.trust_reason === "string" ? payload.trust_reason : "",
    typeof payload.signer_key_id === "string" ? `KeyId ${payload.signer_key_id}` : "",
    payload.legacy_converted === true ? "legacy-converted" : ""
  ]
    .filter(Boolean)
    .join(" | ");

  if (payload.trust_status === "unknown") {
    setStatus("warning", "Artifact verified with unknown signer trust.");
  } else {
    setStatus("success", "Artifact verification succeeded.");
  }
  setBusy(false);

  await refreshWorkspaceData(true);
}

async function handleImportSession(): Promise<void> {
  const json = artifactInput.value.trim();
  if (!json) {
    setStatus("warning", "Paste artifact JSON first.");
    return;
  }

  const importMode = parseModeValue(importModeSelect.value);
  const targetParsed = importTargetUrlInput.value.trim() ? parseTargetUrl(importTargetUrlInput.value) : null;
  if (importTargetUrlInput.value.trim() && !targetParsed) {
    setStatus("warning", "Import target URL is invalid.");
    return;
  }

  setBusy(true);
  clearImportPanels();

  let response = await sendBridgeMessage({
    type: MESSAGE_IMPORT_SESSION,
    artifact_json: json,
    import_mode: importMode,
    target_url: targetParsed?.href,
    dry_run: dryRunCheckbox.checked
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
          artifact_json: json,
          import_mode: importMode,
          target_url: targetParsed?.href,
          dry_run: dryRunCheckbox.checked
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
    await refreshWorkspaceData(true);
    return;
  }

  const payload = response.data as {
    report?: unknown;
    key_fingerprint?: unknown;
    legacy_converted?: unknown;
    trust_status?: unknown;
    mode_used?: unknown;
    target_url_used?: unknown;
    dry_run?: unknown;
  };
  const report = toImportReport(payload.report);
  if (report) {
    renderImportReport(report);
  }

  verifyPanel.classList.remove("hidden");
  verifySummary.textContent = [
    typeof payload.key_fingerprint === "string" ? `Signer ${payload.key_fingerprint}` : "",
    typeof payload.trust_status === "string" ? `Trust ${payload.trust_status}` : "",
    typeof payload.mode_used === "string" ? `Mode ${payload.mode_used}` : "",
    typeof payload.target_url_used === "string" ? `Target ${payload.target_url_used}` : "",
    payload.legacy_converted === true ? "legacy-converted" : "native-v2",
    payload.dry_run === true ? "dry-run" : "applied"
  ]
    .filter(Boolean)
    .join(" | ");

  if (payload.dry_run === true) {
    setStatus("success", "Dry-run preflight completed.");
  } else if (payload.trust_status === "unknown") {
    setStatus("warning", "Session imported with unknown signer trust.");
  } else {
    setStatus("success", "Session import completed.");
  }

  setBusy(false);
  await refreshWorkspaceData(true);
}

function renderVaultEntries(entries: VaultEntry[]): void {
  vaultList.innerHTML = "";
  if (entries.length === 0) {
    vaultList.appendChild(createEmptyWorkspaceItem("No vault entries yet."));
    return;
  }

  for (const entry of entries) {
    const item = document.createElement("li");
    item.className = "workspace-item vault-item";

    const info = document.createElement("div");
    info.className = "workspace-copy";

    const titleRow = document.createElement("div");
    titleRow.className = "workspace-title-row";
    const title = document.createElement("p");
    title.className = "workspace-title";
    title.textContent = `${entry.origin_host} - ${operationLabel(entry.last_operation)}`;
    titleRow.append(title, createTrustPill(entry.trust_status));

    const artifactLine = document.createElement("p");
    artifactLine.className = "workspace-meta workspace-code";
    artifactLine.textContent = `Artifact ${entry.artifact_id}`;

    const signerLine = document.createElement("p");
    signerLine.className = "workspace-meta workspace-code";
    signerLine.textContent = `Signer ${entry.signer_fingerprint}`;

    const detailParts = [
      `Created ${formatUtcLabel(entry.created_at_utc)}`,
      `Updated ${formatUtcLabel(entry.updated_at_utc)}`,
      `Last action ${formatUtcLabel(entry.last_operation_at_utc)}`
    ];
    if (entry.import_mode) {
      detailParts.push(`Mode ${modeLabel(entry.import_mode)}`);
    }
    if (entry.target_url) {
      detailParts.push(`Target ${entry.target_url}`);
    }
    const detailLine = document.createElement("p");
    detailLine.className = "workspace-meta";
    detailLine.textContent = detailParts.join(" | ");

    info.append(titleRow, artifactLine, signerLine, detailLine);

    if (entry.report) {
      const reportLine = document.createElement("p");
      reportLine.className = "workspace-meta";
      reportLine.textContent =
        `Results: imported ${entry.report.imported}, failed ${entry.report.failed}, ` +
        `skipped ${entry.report.skipped}, total ${entry.report.total}`;
      info.appendChild(reportLine);
    }

    const actions = document.createElement("div");
    actions.className = "workspace-actions";

    const useButton = document.createElement("button");
    useButton.className = "btn-ghost";
    useButton.type = "button";
    setButtonContent(useButton, "file", "Load");
    useButton.addEventListener("click", () => {
      artifactInput.value = entry.artifact_json;
      refreshControlStates();
      showTab("import");
      setStatus("info", "Loaded artifact from vault.");
    });

    const verifyButton = document.createElement("button");
    verifyButton.className = "btn-ghost";
    verifyButton.type = "button";
    setButtonContent(verifyButton, "check", "Verify");
    verifyButton.addEventListener("click", () => {
      artifactInput.value = entry.artifact_json;
      refreshControlStates();
      showTab("import");
      void handleVerifyArtifact();
    });

    const importButton = document.createElement("button");
    importButton.className = "btn-ghost";
    importButton.type = "button";
    setButtonContent(importButton, "import", "Import");
    importButton.addEventListener("click", () => {
      artifactInput.value = entry.artifact_json;
      refreshControlStates();
      showTab("import");
      void handleImportSession();
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "btn-ghost";
    deleteButton.type = "button";
    setButtonContent(deleteButton, "trash", "Delete");
    deleteButton.addEventListener("click", async () => {
      setBusy(true);
      const response = await sendBridgeMessage({ type: MESSAGE_DELETE_VAULT_ENTRY, id: entry.id });
      if (!response.ok) {
        setStatus("error", describeError(response.error));
        setBusy(false);
        return;
      }
      setBusy(false);
      await loadVault(vaultSearchInput.value);
      setStatus("success", "Vault entry deleted.");
    });

    actions.append(useButton, verifyButton, importButton, deleteButton);
    item.append(info, actions);
    vaultList.appendChild(item);
  }
}

async function loadVault(query = "", silent = false): Promise<void> {
  const response = await sendBridgeMessage({ type: MESSAGE_LIST_VAULT, query });
  if (!response.ok) {
    if (!silent) {
      setStatus("error", describeError(response.error));
    }
    return;
  }

  const entries = (response.data as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    if (!silent) {
      setStatus("error", "Vault response payload is invalid.");
    }
    return;
  }

  renderVaultEntries(entries as VaultEntry[]);
}

function renderSigners(signers: SignerRecord[]): void {
  signerList.innerHTML = "";
  if (signers.length === 0) {
    signerList.appendChild(createEmptyWorkspaceItem("No signer records."));
    return;
  }

  for (const signer of signers) {
    const item = document.createElement("li");
    item.className = "workspace-item signer-item";

    const info = document.createElement("div");
    info.className = "workspace-copy";

    const titleRow = document.createElement("div");
    titleRow.className = "workspace-title-row";
    const title = document.createElement("p");
    title.className = "workspace-title workspace-code";
    title.textContent = signer.key_fingerprint;
    titleRow.append(title, createTrustPill(signer.trust_status));

    const keyIdLine = document.createElement("p");
    keyIdLine.className = "workspace-meta workspace-code";
    keyIdLine.textContent = `Key ID ${signer.signer_key_id || "(none)"}`;

    const reasonLine = document.createElement("p");
    reasonLine.className = "workspace-meta";
    reasonLine.textContent = signer.trust_reason;

    const timeLine = document.createElement("p");
    timeLine.className = "workspace-meta";
    const timeParts = [`Updated ${formatUtcLabel(signer.updated_at_utc)}`];
    if (signer.last_seen_at_utc) {
      timeParts.push(`Last seen ${formatUtcLabel(signer.last_seen_at_utc)}`);
    }
    timeLine.textContent = timeParts.join(" | ");

    info.append(titleRow, keyIdLine, reasonLine, timeLine);

    const actions = document.createElement("div");
    actions.className = "workspace-actions";

    const select = document.createElement("select");
    select.innerHTML = [
      `<option value="none">No override</option>`,
      `<option value="trusted">Trusted</option>`,
      `<option value="blocked">Blocked</option>`
    ].join("");

    if (signer.trust_status === "trusted") {
      select.value = "trusted";
    } else if (signer.trust_status === "blocked") {
      select.value = "blocked";
    } else {
      select.value = "none";
    }

    const saveButton = document.createElement("button");
    saveButton.className = "btn-ghost";
    saveButton.type = "button";
    setButtonContent(saveButton, "save", "Save");

    if (signer.trust_status === "self") {
      select.disabled = true;
      saveButton.disabled = true;
    }

    saveButton.addEventListener("click", async () => {
      setBusy(true);
      const decision = select.value === "trusted" || select.value === "blocked" ? select.value : "none";
      const response = await sendBridgeMessage({
        type: MESSAGE_SET_SIGNER_TRUST,
        key_fingerprint: signer.key_fingerprint,
        decision
      });

      if (!response.ok) {
        setStatus("error", describeError(response.error));
        setBusy(false);
        return;
      }

      setBusy(false);
      setStatus("success", `Updated signer trust for ${signer.key_fingerprint}.`);
      await loadSigners(true);
    });

    actions.append(select, saveButton);
    item.append(info, actions);
    signerList.appendChild(item);
  }
}

async function loadSigners(silent = false): Promise<void> {
  const response = await sendBridgeMessage({ type: MESSAGE_LIST_SIGNERS });
  if (!response.ok) {
    if (!silent) {
      setStatus("error", describeError(response.error));
    }
    return;
  }

  const signers = (response.data as { signers?: unknown }).signers;
  if (!Array.isArray(signers)) {
    if (!silent) {
      setStatus("error", "Signer response payload is invalid.");
    }
    return;
  }

  renderSigners(signers as SignerRecord[]);
}

function renderPresets(presets: ImportPreset[]): void {
  presetList.innerHTML = "";
  if (presets.length === 0) {
    presetList.appendChild(createEmptyWorkspaceItem("No presets configured."));
    return;
  }

  for (const preset of presets) {
    const item = document.createElement("li");
    item.className = "workspace-item preset-item";

    const info = document.createElement("div");
    info.className = "workspace-copy";

    const title = document.createElement("p");
    title.className = "workspace-title";
    title.textContent = preset.host;

    const modeLine = document.createElement("p");
    modeLine.className = "workspace-meta";
    modeLine.textContent = `Default mode: ${modeLabel(preset.default_mode)}`;

    info.append(title, modeLine);
    if (preset.warning_hint) {
      const warningLine = document.createElement("p");
      warningLine.className = "workspace-meta";
      warningLine.textContent = `Hint: ${preset.warning_hint}`;
      info.appendChild(warningLine);
    }

    const updatedLine = document.createElement("p");
    updatedLine.className = "workspace-meta";
    updatedLine.textContent = `Updated ${formatUtcLabel(preset.updated_at_utc)}`;
    info.appendChild(updatedLine);

    const actions = document.createElement("div");
    actions.className = "workspace-actions";

    const applyButton = document.createElement("button");
    applyButton.className = "btn-ghost";
    applyButton.type = "button";
    setButtonContent(applyButton, "play", "Apply");
    applyButton.addEventListener("click", () => {
      importModeSelect.value = preset.default_mode;
      importTargetUrlInput.value = `https://${preset.host}/`;
      showTab("import");
      if (preset.warning_hint) {
        setStatus("warning", `Preset warning: ${preset.warning_hint}`);
      } else {
        setStatus("info", `Applied preset for ${preset.host}.`);
      }
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "btn-ghost";
    deleteButton.type = "button";
    setButtonContent(deleteButton, "trash", "Delete");
    deleteButton.addEventListener("click", async () => {
      setBusy(true);
      const response = await sendBridgeMessage({ type: MESSAGE_DELETE_PRESET, id: preset.id });
      if (!response.ok) {
        setStatus("error", describeError(response.error));
        setBusy(false);
        return;
      }
      setBusy(false);
      await loadPresets(true);
      setStatus("success", "Preset deleted.");
    });

    actions.append(applyButton, deleteButton);
    item.append(info, actions);
    presetList.appendChild(item);
  }
}

async function loadPresets(silent = false): Promise<void> {
  const response = await sendBridgeMessage({ type: MESSAGE_LIST_PRESETS });
  if (!response.ok) {
    if (!silent) {
      setStatus("error", describeError(response.error));
    }
    return;
  }

  const presets = (response.data as { presets?: unknown }).presets;
  if (!Array.isArray(presets)) {
    if (!silent) {
      setStatus("error", "Preset response payload is invalid.");
    }
    return;
  }

  presetCache = presets as ImportPreset[];
  renderPresets(presetCache);
}

async function handleSavePreset(): Promise<void> {
  const host = presetHostInput.value.trim();
  if (!host) {
    setStatus("warning", "Preset host is required.");
    return;
  }

  const defaultMode = parseModeValue(presetModeSelect.value);
  const warningHint = presetWarningInput.value.trim();

  setBusy(true);
  const response = await sendBridgeMessage({
    type: MESSAGE_UPSERT_PRESET,
    host,
    default_mode: defaultMode,
    warning_hint: warningHint
  });

  if (!response.ok) {
    setStatus("error", describeError(response.error));
    setBusy(false);
    return;
  }

  presetHostInput.value = "";
  presetWarningInput.value = "";
  setBusy(false);
  await loadPresets(true);
  setStatus("success", "Preset saved.");
}

function bindEvents(): void {
  tabExportButton.addEventListener("click", () => {
    showTab("export");
  });
  tabImportButton.addEventListener("click", () => {
    showTab("import");
  });
  tabWorkspaceButton.addEventListener("click", () => {
    showTab("workspace");
    void refreshWorkspaceData(true);
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
  artifactInput.addEventListener("input", () => {
    refreshControlStates();
  });
  verifyArtifactButton.addEventListener("click", () => {
    void handleVerifyArtifact();
  });
  importSessionButton.addEventListener("click", () => {
    void handleImportSession();
  });

  refreshVaultButton.addEventListener("click", () => {
    void loadVault(vaultSearchInput.value);
  });
  searchVaultButton.addEventListener("click", () => {
    void loadVault(vaultSearchInput.value);
  });

  refreshSignersButton.addEventListener("click", () => {
    void loadSigners();
  });

  refreshPresetsButton.addEventListener("click", () => {
    void loadPresets();
  });
  savePresetButton.addEventListener("click", () => {
    void handleSavePreset();
  });
}

function init(): void {
  setupIconography();
  bindEvents();
  setStatus("info", "Choose Export, Import, or Workspace to get started.");
  setBusy(false);
  clearImportPanels();
  showTab("export");
  void handleDetectActiveTab(true);
  void refreshWorkspaceData(true);
}

init();
