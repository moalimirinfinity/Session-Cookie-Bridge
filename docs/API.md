# API Reference

This document covers the extension's runtime message contracts and response shapes.

## Overview

All runtime requests use `chrome.runtime.sendMessage` with a typed `BridgeRequestMessage` payload.
All responses use `ResponseEnvelope<T>`:

```ts
{ ok: true, data: T }
{ ok: false, error: { code, message, details? } }
```

## Core Requests

### `REQUEST_ACTIVE_TAB_CONTEXT`
Request:
```json
{ "type": "REQUEST_ACTIVE_TAB_CONTEXT" }
```

Response `ok` data:
- `target_url`
- `origin`
- `host_pattern`
- `title?`
- `tab_id?`

### `EXPORT_SESSION`
Request:
```json
{ "type": "EXPORT_SESSION", "target_url": "https://example.com/" }
```

Response `ok` data:
- `artifact` (`SessionArtifactV2`)
- `key_fingerprint`

### `VERIFY_ARTIFACT`
Request:
```json
{ "type": "VERIFY_ARTIFACT", "artifact_json": "{...}" }
```

Response `ok` data:
- `valid`
- `schema_version`
- `key_fingerprint`
- `cookie_count`
- `legacy_converted`
- `trust_status` (`self | trusted | unknown | blocked`)
- `trust_reason`
- `signer_key_id`

### `IMPORT_SESSION`
Request:
```json
{
  "type": "IMPORT_SESSION",
  "artifact_json": "{...}",
  "import_mode": "rewrite_current_app",
  "target_url": "https://target.example/",
  "dry_run": false
}
```

Fields:
- `artifact_json` (required)
- `import_mode?`: `rewrite_current_app` (default) or `exact_replay`
- `target_url?`: used in rewrite mode (falls back to active tab URL)
- `dry_run?`: if `true`, validate only and do not write cookies

Response `ok` data:
- `key_fingerprint`
- `legacy_converted`
- `trust_status`
- `mode_used`
- `target_url_used`
- `dry_run`
- `report`:
  - `total`
  - `imported`
  - `failed`
  - `skipped`
  - `results[]` with per-cookie statuses:
    - `imported`
    - `failed`
    - `skipped`
    - `dry_run`

### `COPY_FIELD`
Request:
```json
{
  "type": "COPY_FIELD",
  "field": "cookie_header",
  "artifact_json": "{...}"
}
```

`field` values:
- `cookie_header` (recomputed from signed cookie records)
- `artifact_json`
- `key_fingerprint`

## Workspace Requests

### Signers
- `LIST_SIGNERS`
- `SET_SIGNER_TRUST`

`SET_SIGNER_TRUST` request:
```json
{
  "type": "SET_SIGNER_TRUST",
  "key_fingerprint": "abc123",
  "decision": "trusted"
}
```

`decision` values:
- `trusted`
- `blocked`
- `none`

### Vault
- `LIST_VAULT`
- `SAVE_TO_VAULT`
- `DELETE_VAULT_ENTRY`

`LIST_VAULT` request:
```json
{ "type": "LIST_VAULT", "query": "example" }
```

### Presets
- `LIST_PRESETS`
- `UPSERT_PRESET`
- `DELETE_PRESET`

`UPSERT_PRESET` request:
```json
{
  "type": "UPSERT_PRESET",
  "host": "example.com",
  "default_mode": "exact_replay",
  "warning_hint": "Run dry-run first"
}
```

## Trust Policy

Default behavior is warn-only:
- `self`: trusted extension key.
- `trusted`: user-approved signer.
- `unknown`: allowed, but warning shown.
- `blocked`: verification/import denied.

## Legacy Compatibility

The background router still supports legacy v1 message constants for one release cycle.
Legacy schema payloads are converted to v2 for import compatibility, but they are not promoted to the local self signer.
Converted v1 payloads verify with `legacy_converted: true` and `unknown` signer trust unless the converted signer is explicitly trusted.

## Common Error Codes

- `INVALID_REQUEST`
- `PERMISSION_DENIED`
- `INVALID_ARTIFACT`
- `SIGNATURE_INVALID`
- `NOT_SIGNED_IN`
- `IMPORT_FAILED`
- `IMPORT_PARTIAL`
- `API_FAILURE`
