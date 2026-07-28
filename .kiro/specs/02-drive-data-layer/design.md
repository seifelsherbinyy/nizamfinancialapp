# Design — Google Drive Data Layer

> Skeleton — KIRO expands during the loop. Honor `.kiro/steering/*`.

## Components / modules
- oauth.ts (drive.file)
- driveClient + driveDb (atomic + snapshots)
- localCache (Dexie) + schema + migrations
- sync.ts (3-way merge)
- Picker import + ledgerImport dedup

## Notes
- Money = integer milliunits. Drive scope = drive.file only. Every file headers its Contract/Phase.
