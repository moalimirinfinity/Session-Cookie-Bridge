# Manual QA Checklist

Use this checklist before packaging a release.

## Prerequisites

1. Build and load unpacked extension from `dist/`.
2. Open extension popup on an active browser tab.
3. Ensure at least one test site where you are signed in.

## Quick Gate

Run:

```bash
npx tsc --noEmit
npm run test
npm run build
npm audit --omit=dev
npm run package:zip
```

Expected: all commands pass.

## Export Flow

1. Open Export tab.
2. Click `Use Active Tab`.
3. Click `Request Permission` and grant.
4. Click `Export Signed Session`.

Verify:
- Cookie header is populated.
- Fingerprint is shown.
- Artifact JSON is shown.
- `Copy Header`, `Copy JSON`, `Download Signed JSON` work.

## Import: Rewrite Mode

1. Open Import tab.
2. Paste artifact JSON.
3. Set mode to `Rewrite Current App`.
4. (Optional) set target URL.
5. Click `Verify Artifact`.

Verify:
- Signature shows valid.
- Trust status is visible (`self/trusted/unknown`).

Then import:
1. Click `Import Session`.
2. Grant permission prompt if shown.

Verify:
- Import report appears.
- Per-cookie statuses are visible.

## Import: Exact Replay

1. Set mode to `Exact Replay`.
2. Click `Import Session`.

Verify:
- Permission prompt can include multiple host patterns.
- Report still includes per-cookie status and reasons.

## Dry Run

1. Enable `Dry-run preflight`.
2. Click `Import Session`.

Verify:
- No cookies are written.
- Report includes `dry_run` entries.
- Status indicates preflight completed.

## Signer Trust

1. Open Workspace tab.
2. In Signer Manager, locate signer row.
3. Set trust to `blocked`, click `Save`.
4. Attempt verify/import for artifact from that signer.

Verify:
- Operation fails with signer/trust error.

5. Set signer to `trusted`, click `Save`.
6. Verify artifact again.

Verify:
- Trust status changes accordingly.

## Vault

1. After export/verify/import, open Workspace -> Artifact Vault.
2. Search by host/fingerprint.
3. Use `Load`, `Re-verify`, `Re-import` actions.
4. Delete an entry.

Verify:
- Actions behave correctly.
- Search filters results.
- Deleted entries disappear.

## Presets

1. In Workspace -> Import Presets, create preset for host.
2. Set default mode and warning hint.
3. Save preset.
4. Apply preset.

Verify:
- Import mode/target behavior updates.
- Warning hint is surfaced.
- Delete removes preset.

## No-Cookie Export Case

1. Use a site with no relevant cookies.
2. Try exporting.

Verify:
- Error is actionable (`NOT_SIGNED_IN` style), not generic crash.

## Regression Check

1. Verify legacy v1 payload still imports.
2. Confirm legacy v1 verification/import shows `legacy_converted: true` and unknown signer trust.
3. Run full test suite again.

Expected: no regressions.
