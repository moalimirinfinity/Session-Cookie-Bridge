import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Session Cookie Bridge",
  version: "0.1.0",
  description: "Private universal cookie session export/import bridge with signed artifacts.",
  icons: {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  action: {
    default_title: "Session Cookie Bridge",
    default_icon: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png"
    },
    default_popup: "src/popup/index.html"
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module"
  },
  permissions: ["cookies", "clipboardWrite", "downloads", "activeTab"],
  optional_host_permissions: ["*://*/*"]
});
