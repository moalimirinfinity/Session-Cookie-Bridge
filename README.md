# Session Cookie Bridge

Private Chromium MV3 extension for signed cookie-session transfer.

Session Cookie Bridge captures browser cookies from a target site, packages them into a signed artifact, verifies signer trust, and imports them into another browser context with controlled rewrite or exact replay modes. It is built for private workflows where session artifacts are handled deliberately, audited locally, and treated as secrets.

## Highlights

- Signed v2 session artifacts with ECDSA P-256 and SHA-256.
- Universal http(s) cookie export through runtime host permissions.
- Import modes for current-app rewrite or exact cookie replay.
- Dry-run preflight with per-cookie import reporting.
- Local signer trust states: `self`, `trusted`, `unknown`, `blocked`.
- Workspace tools for artifact history, signer management, and import presets.
- Legacy v1 Medium artifacts convert to v2 with unknown signer trust.

## Security Model

Exported artifacts contain authentication cookies. Treat them like credentials.

- Do not commit exported artifacts.
- Share artifacts only through trusted private channels.
- Rotate affected sessions immediately if an artifact leaks.
- Storage remains local in `chrome.storage.local`; there is no cloud sync or escrow.

## Install

Requires Node.js 20.19+; Node 22 is recommended and used by CI.

```bash
nvm use
npm install
npm run build
```

Load `dist/` as an unpacked extension from `chrome://extensions`.

## Private ZIP

```bash
npm run package:zip
```

The distributable ZIP is written to `dist/releases/` and is intentionally ignored by git.

## Validate

```bash
npx tsc --noEmit
npm run test
npm run build
npm audit --omit=dev
```

## Manual QA

Before distributing a ZIP, smoke test:

- Export from a signed-in site.
- Verify signer trust, including unknown and blocked signer paths.
- Import with rewrite, exact replay, and dry-run modes.
- Exercise vault load, re-verify, re-import, and delete actions.
- Create, apply, and delete an import preset.
- Confirm legacy v1 artifacts import as `legacy_converted: true` with unknown signer trust.

Full API and QA references:

- [API Reference](docs/API.md)
- [Manual QA Checklist](docs/MANUAL-QA.md)

## Scope

This extension transfers cookie-backed sessions only. It does not migrate `localStorage`, IndexedDB, service worker state, device-bound tokens, or server-side anti-hijack state.
