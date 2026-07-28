# Money Rules (INVARIANT — never violate)
1. Money is an **integer** number of **milliunits**. 1 EGP = 1000 milliunits. 1 piastre = 10 milliunits.
2. NO floating-point money anywhere. Parse decimals -> integer milliunits at the boundary; format integer -> string only for display.
3. `allocate(total, weights)` MUST sum EXACTLY to `total` (distribute remainder deterministically).
4. Signed convention: outflow negative, inflow positive in `amount`; `outflow`/`inflow` columns are non-negative magnitudes.
5. Display: `Intl.NumberFormat` for `EGP`, locale `ar-EG` or `en`; negatives and RAG handled in the MoneyCell component.
6. Every money function is unit-tested for round-trip + no-drift before its phase is DONE.
