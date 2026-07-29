# ADR-0002 — GIS token client + Drive API v3 via fetch (no gapi client lib)

- **Status:** Accepted · **Owner:** KIRO Contract 2 · **Date:** 2026-07-29

## Context
NIZAM is a static SPA whose database is a JSON file in the user's own Google Drive
(ADR-0001). It needs browser-side OAuth and Drive file CRUD with the least code,
least scope, and no backend.

## Decision
1. **Auth:** Google Identity Services **token model** (`google.accounts.oauth2.initTokenClient`)
   — Google's supported flow for SPAs calling Google APIs directly. The deprecated
   `gapi.auth2` is avoided. Access tokens live in memory only.
   Ref: https://developers.google.com/identity/oauth2/web/guides/use-token-model
2. **Scope:** exactly `https://www.googleapis.com/auth/drive.file` (non-sensitive; app sees only
   files it created or the user picked). Asserted at runtime on every token response.
   Ref: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
3. **Drive access:** plain `fetch` against Drive **REST v3** (files.list/get/create/update with
   `uploadType=multipart|media`, `alt=media` reads) instead of the heavyweight gapi discovery
   client. Backoff on 403/429/5xx. Optimistic concurrency via the file's `version` field.
   Ref: https://developers.google.com/workspace/drive/api/reference/rest/v3
4. **Picker:** Google Picker API for the one-time import grant on the existing master ledger.
   Ref: https://developers.google.com/workspace/drive/picker/guides/overview

## Consequences
- No secret is ever shipped: client id + API key are public identifiers restricted by origin.
- Tokens expire ~hourly; the UI must surface a re-connect action (handled in the session slice).
- All Drive calls degrade to the offline Dexie cache when no token / no network.
