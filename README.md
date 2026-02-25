# Session Cookie Bridge

Private Chromium MV3 extension for extracting signed-in session cookies and exporting import-ready artifacts.

## Sensitive Data Warning
This extension handles authentication cookies. Treat all copied/exported outputs as secrets.

- Do not commit outputs to git.
- Do not send outputs to shared chats.
- Rotate sessions if a cookie leaks.

## V1 Scope

- Chromium-first (`chrome`, `brave`, `edge` unpacked extension)
- Medium adapter enabled (`medium.com`)
- Output actions:
  - Copy Cookie header
  - Copy `.env` block
  - Copy CLI import snippet
  - Export JSON artifact
- No persistent cookie storage in extension storage

## Architecture

- `src/platforms/types.ts`: `PlatformAdapter` interface (extensible site-adapter model)
- `src/platforms/registry.ts`: active adapters registry
- `src/platforms/medium.adapter.ts`: Medium-specific mapping/formatting
- `src/background/index.ts`: typed message router + cookie API access
- `src/popup/*`: UI flow and clipboard/export actions
- `src/core/*`: cookie/format/validation/export orchestration
- `src/shared/*`: stable message contracts and shared types

## Permissions Model

`manifest_version: 3`

- `permissions`
  - `cookies`
  - `clipboardWrite`
  - `downloads`
  - `activeTab`
- `optional_host_permissions`
  - `https://medium.com/*`

Host permission is requested at runtime when you click `Extract Cookies`.

## Build and Local Install

```bash
npm install
npm run build
```

Then open `chrome://extensions`:

1. Enable `Developer mode`
2. Click `Load unpacked`
3. Select the built output folder `dist/`

## Packaging Zip Artifact

```bash
npm run package:zip
```

Creates a versioned zip under `dist/releases/`.

## Icon Assets

Extension icons are generated assets under `public/icons/`.

To regenerate all icon sizes (`16`, `32`, `48`, `128`):

```bash
npm run icons:generate
```

`src/manifest.ts` references these files directly for extension and action icons.

## Popup Flow (V1)

1. Select platform (Medium)
2. Click `Extract Cookies`
3. Approve host permission prompt if requested
4. Review required-cookie health (`sid`, `uid`, `xsrf`)
5. Use one-click actions:
   - `Copy Cookie Header`
   - `Copy .env Block`
   - `Copy CLI Snippet`
   - `Export JSON`

Error states are surfaced for:

- permission denied
- not signed in (missing required cookies)
- runtime/API failures

## Medium Output Formats

### Cookie Header

```text
sid=...; uid=...; xsrf=...; cf_clearance=...; _cfuvid=...; ...rest-alpha
```

### `.env` Block

```env
MEDIUM_SESSION=""
MEDIUM_SESSION_SID="..."
MEDIUM_SESSION_UID="..."
MEDIUM_SESSION_XSRF="..."
MEDIUM_SESSION_CF_CLEARANCE=""
MEDIUM_SESSION_CFUVID=""
MEDIUM_CSRF=""
MEDIUM_USER_REF=""
```

### CLI Snippet

```bash
uv run bot auth-import --cookie-header 'sid=...; uid=...; xsrf=...'
```

### JSON Payload (schema v1)

- `schema_version: 1`
- `platform: "medium"`
- `created_at_utc`
- `cookie_header`
- `cookies` (name/value map)
- `required_present`
- `env_block`
- `cli_import_snippet`

## Testing

```bash
npm run test
```

Automated tests cover:

- adapter cookie detection and output formatting
- header ordering and CLI escaping
- extraction error shape for missing required cookies
- schema validation correctness
- message request/response contract validation
- no-persistence guard (no `chrome.storage`/`localStorage` usage)

## Manual Validation Checklist

- [ ] Medium signed in: extraction succeeds
- [ ] Medium signed out: not-signed-in error shown
- [ ] Clipboard copy works for header/env/CLI
- [ ] JSON export downloads correctly
- [ ] Host permission denial path handled cleanly

## Extending to Another Platform

1. Add a new adapter in `src/platforms/<platform>.adapter.ts`
2. Implement `PlatformAdapter` methods
3. Register adapter in `src/platforms/registry.ts`
4. Add adapter tests and output fixtures

Core extraction/export logic should not require refactors for new platforms.
