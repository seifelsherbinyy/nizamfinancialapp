# Hermes workspace mount (Option B)

> Owning authority: PFOS Contract 14; Contracts 06 and 12; nizamcore HIMAYAH/THABAT; Drive scope.
> Status: specification only. This file authorizes no clone, install, start, or host write.

## Repositories

Keep two independently versioned repositories. Do not merge them.

| Mount | Default access | Write path |
|---|---|---|
| this repository (`nizamfinancialapp`) | read contracts, `src/server`, `src/lib/money` | PFOS tools only, via deterministic engines |
| `nizamcore` | read personas, skills, non-secret registries | NIZAMCORE journal/signal tools only, after HIMAYAH |

## Forbidden mount paths

- `.secrets/`, `.env`, `.env.local`, host `/etc/nizam`
- `[classified-family-path]/**` (excluded classification tier — written without
  the contiguous name so this specification file does not serve as a reference;
  see contracts/CONTRACT_6 and the exclusion refusal tests for the assembled form)
- raw `YAWMIYAT` / `TAFRIGH` session bodies into embeddings or Drive
- any file that contains a credential or deployment particular

## Runtime pin

Use the already-installed VPS line **Hermes 0.15.2** in `/opt/nizam/hermes`.
Do not install Hermes on the laptop. Do not start the gateway while any process
still polls `BOT_A_TOKEN` or `BOT_B_TOKEN`.

## Rollback

Keep `ops/hermes/nizam.*` and `ops/hermes/pfos.*` as the two-home rollback.
Ingress uses `ops/hermes/nizam-ingress.*` only after the owner confirms the new
token is present and the legacy pollers are stopped.
