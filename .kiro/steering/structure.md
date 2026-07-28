# Structure — NIZAM
```
src/
  app/            router + providers
  features/       budget · accounts · transactions · reconciliation · reports · import
  lib/money       integer money core (milliunits)
  lib/drive       oauth · driveClient · driveDb · sync · picker  (Drive-as-database)
  lib/ledger      canonical ledger types + read model
  lib/db          schema · migrations · localCache (Dexie)
  state           Zustand store
  styles          YNAB-inspired tokens
data/             ledger schema + seeds (real ledgers gitignored)
docs/             architecture · adr · research (from Drive)
contracts/        the 5 KIRO build contracts (human-readable)
.kiro/specs/      per-contract requirements/design/tasks (KIRO-native)
tests/            vitest
```
**Rule:** every source file names the Contract/Phase that implements it in its header. Don't implement out of contract order unless a dependency demands it (then note it).
