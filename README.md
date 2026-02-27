# Session Cookie Bridge v2

Private Chromium MV3 extension for best-effort cookie session transfer:
- Export signed session artifacts from any http(s) site.
- Verify artifact integrity/signature.
- Import verified artifacts back into browser cookies with per-cookie reporting.

## Sensitive Data Warning
This extension handles authentication cookies and signed session artifacts.

- Treat exported JSON as secrets.
- Do not commit artifacts to git.
- Rotate sessions immediately if data leaks.

## Scope and Limits

### In scope
- Cookie-based session export/import only.
- Signed artifact integrity checks (ECDSA P-256 + SHA-256).
- Runtime host permission prompts per target host/domain.
- Legacy v1 Medium artifact import compatibility (auto-converted to v2).

### Out of scope
- `localStorage`, IndexedDB, service worker token migration.
- Guaranteed replay on all platforms.

Some sites use device binding, anti-hijack, or server-side checks that can invalidate imported cookies even when import is successful.

## Architecture
- `src/shared/types.ts`: v2 artifact, cookie, signature, import-report, legacy compatibility types.
- `src/shared/messages.ts`: new message contract + one-cycle legacy constants.
- `src/core/canonicalJson.ts`: deterministic canonical JSON utility for signing.
- `src/core/signingService.ts`: key management, signing, verification, fingerprinting.
- `src/core/cookieService.ts`: cookie read/set APIs, host-pattern planning, import report generation.
- `src/core/exportService.ts`: signed v2 export + legacy bundle shim.
- `src/core/importService.ts`: artifact parse, v1 conversion, signature verification, cookie-constraint validation, import orchestration.
- `src/background/index.ts`: typed message router for export/verify/import/copy and legacy shims.
- `src/popup/*`: two-tab export/import UI.
- `src/platforms/*`: optional legacy profile/adapters (Medium kept for shim/hints).

## Permissions Model

Manifest (`MV3`) permissions:
- `cookies`
- `clipboardWrite`
- `downloads`
- `activeTab`

Host permissions:
- `optional_host_permissions: ["*://*/*"]`
- Runtime prompts are scoped to exact required host patterns.

## Artifact Schema v2

Signed export shape:
- `schema_version: 2`
- `artifact_id`
- `created_at_utc`
- `source`
  - `target_url`
  - `origin`
  - `captured_by_extension_version`
- `cookies: CookieRecordV2[]`
- `derived`
  - `cookie_header`
  - `cookie_count`
- `signature`
  - `alg: "ECDSA_P256_SHA256"`
  - `key_id`
  - `public_key_jwk`
  - `payload_sha256`
  - `signature_base64url`
  - `signed_at_utc`

## Popup Flows

### Export tab
1. Use active tab URL or enter target URL manually.
2. Request host permission (exact host pattern).
3. Export signed artifact.
4. Copy cookie header / copy JSON / download JSON.

### Import tab
1. Paste or upload artifact JSON.
2. Verify signature.
3. Import session cookies.
4. Inspect import report (`imported`, `failed`, `skipped`) per cookie.

## Legacy Compatibility

For one release cycle:
- Legacy message constants remain available in background router.
- Legacy v1 payload import is supported by converting to v2 and re-signing locally before import.

## Build and Load

```bash
npm install
npm run build
```

Then:
1. Open `chrome://extensions`
2. Enable `Developer mode`
3. `Load unpacked` -> select `dist/`

## Tests

```bash
npm run test
```

Coverage includes:
- Message contract validation (v2 + legacy shim).
- Signed export generation and tamper detection.
- Import verification, partial-failure behavior, unsupported cookie handling.
- Cookie mapping and host-pattern derivation.
- Legacy v1 conversion path.

## Current Validation (Feb 27, 2026)

- `npm run test` passed.
- `npm run build` passed.
