# Session Cookie Bridge v2

Private Chromium MV3 extension for best-effort cookie session transfer:
- Export signed session artifacts from any http(s) site.
- Verify artifact integrity/signature with signer trust status.
- Import verified artifacts with rewrite/exact mode, optional dry-run, and per-cookie reporting.
- Manage artifacts, signers, and import presets in a built-in Workspace.

## Sensitive Data Warning
This extension handles authentication cookies and signed session artifacts.

- Treat exported JSON as secrets.
- Do not commit artifacts to git.
- Rotate sessions immediately if data leaks.

## Scope and Limits

### In scope
- Cookie-based session export/import only.
- Signed artifact integrity checks (ECDSA P-256 + SHA-256).
- Signer trust model (`self`, `trusted`, `unknown`, `blocked`) with warn-only default.
- Runtime host permission prompts per target host/domain.
- Dry-run preflight and vault operation logs.
- Legacy v1 Medium artifact import compatibility (auto-converted to v2 with unknown signer trust).

### Out of scope
- `localStorage`, IndexedDB, service worker token migration.
- Guaranteed replay on all platforms.
- Cloud sync/escrow of keys, trust, vault, or presets.

Some sites use device binding, anti-hijack, or server-side checks that can invalidate imported cookies even when import is successful.

## Architecture
- `src/shared/types.ts`: v2 artifact schema, trust/vault/preset types, import-mode contracts.
- `src/shared/messages.ts`: message contracts for export/verify/import/copy + signer/vault/preset APIs.
- `src/core/signingService.ts`: signing keys, verification, trust store (`trust.v1`), signer management.
- `src/core/cookieService.ts`: cookie read/set APIs, host-pattern planning, import report generation.
- `src/core/exportService.ts`: signed v2 export + no-cookie actionable errors + legacy bundle shim.
- `src/core/importService.ts`: artifact parse, v1 conversion, trust-aware verification, import modes, dry-run.
- `src/core/workspaceService.ts`: artifact vault (`vault.v1`) and import presets (`presets.v1`).
- `src/background/index.ts`: typed message router and orchestration.
- `src/popup/*`: Export, Import, and Workspace UI.
- `src/platforms/*`: optional legacy profile/adapters (Medium kept for shim/hints).

## Storage Model

Local `chrome.storage.local` keys:
- `signing.v1`: local ECDSA key pair (`key_id`, public/private JWK).
- `trust.v1`: signer decisions (`trusted`/`blocked`) + last-seen metadata.
- `vault.v1`: recent artifacts + last operation metadata/report.
- `presets.v1`: host-based import defaults and warning hints.

## Permissions Model

Manifest (`MV3`) permissions:
- `cookies`
- `clipboardWrite`
- `downloads`
- `activeTab`
- `storage`

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
2. Choose import mode:
   - `rewrite_current_app` (default)
   - `exact_replay`
3. Optionally set dry-run preflight.
4. Verify signature + trust status.
5. Import session cookies and inspect detailed report.

### Workspace tab
- Artifact Vault: search, reuse, re-verify, re-import, delete.
- Signer Manager: mark signers trusted/blocked/none.
- Import Presets: host-based mode defaults and warning hints.

## Message API

Key request types:
- `REQUEST_ACTIVE_TAB_CONTEXT`
- `EXPORT_SESSION`
- `VERIFY_ARTIFACT`
- `IMPORT_SESSION` (`import_mode?`, `target_url?`, `dry_run?`)
- `COPY_FIELD`
- `LIST_SIGNERS`
- `SET_SIGNER_TRUST`
- `LIST_VAULT`
- `SAVE_TO_VAULT`
- `DELETE_VAULT_ENTRY`
- `LIST_PRESETS`
- `UPSERT_PRESET`
- `DELETE_PRESET`

Detailed request/response contracts are documented in [docs/API.md](/Users/moalimir/Project%20World/Session-Cookie-Bridge/docs/API.md).

## Build and Load

```bash
npm install
npm run build
```

Then:
1. Open `chrome://extensions`
2. Enable `Developer mode`
3. `Load unpacked` -> select `dist/`

## Private ZIP Packaging

```bash
npm run package:zip
```

The release ZIP is written under `dist/releases/` and is intentionally not committed to git.
Use `dist/` for local unpacked smoke testing before distributing the ZIP.

## Tests

```bash
npm run test
```

Coverage includes:
- Message contract validation (v2 + legacy shim + workspace APIs).
- Signed export generation and tamper detection.
- Import verification, trust policy, dry-run behavior, partial-failure behavior.
- Cookie mapping and host-pattern derivation.
- Legacy v1 conversion path.
- Workspace vault/preset persistence behavior.

## Release Checklist

1. `npx tsc --noEmit`
2. `npm run test`
3. `npm run build`
4. `npm audit --omit=dev`
5. `npm run package:zip`
6. Manual smoke checks:
   - Export from active signed-in site
   - Verify unknown signer warning path
   - Import rewrite mode + exact mode
   - Dry-run with expected preflight results
   - Vault re-verify/re-import actions
   - Signer trust override (`trusted`/`blocked`) behavior
   - Legacy v1 import reports `legacy_converted: true` and unknown signer trust

Detailed manual test script is in [docs/MANUAL-QA.md](/Users/moalimir/Project%20World/Session-Cookie-Bridge/docs/MANUAL-QA.md).

## CI

A GitHub Actions workflow is expected at `.github/workflows/ci.yml` to run:
- typecheck
- tests
- build
- production audit (`npm audit --omit=dev`)

## Dependency Maintenance

- Review `npm audit` results monthly.
- Prioritize updates for `@crxjs/vite-plugin`, `vitest`, and transitive build-tool dependencies.
