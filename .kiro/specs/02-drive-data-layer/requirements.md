# Requirements — Google Drive Data Layer

> KIRO spec for Contract 2. Full contract: `contracts/CONTRACT_2_*.md`. Read steering first.

## User story
As the sole user, I want google drive data layer so the NIZAM build advances one verifiable contract.

## Acceptance criteria (EARS)
- THE SYSTEM SHALL authenticate via GIS with scope drive.file ONLY.
- THE SYSTEM SHALL load/save a canonical nizam_db.json in the user's Drive atomically with snapshots.
- WHEN offline THE SYSTEM SHALL keep working from the Dexie cache and sync on reconnect.
- WHEN remote and local diverge THE SYSTEM SHALL resolve via 3-way merge and log conflicts.
- THE SYSTEM SHALL import the existing master_ledger via Google Picker and dedup rows.
