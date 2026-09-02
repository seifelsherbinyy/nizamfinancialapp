"""
NIZAM · read-only synthetic MAL/PFOS migration rehearsal
Owning contract: UPOI task 6.2; requirements 2.1–2.3 and 3.1–3.3; design §11.1.
Phase: UPOI task 6.2 — synthetic staging only; no live source, provider, or writer.

This module inventories a documented legacy shape and maps only caller-supplied synthetic
records into PFOS-shaped candidates. It has no filesystem, database, network, secret, or
canonical-writer dependency. A migration result is a staged parity receipt, never an import.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass
import hashlib
import json
import re
from typing import Any

from .pfos_port import MilliunitBoundaryError, parse_milliunits, validate_milliunits


MILLIUNITS_PER_EGP = 1000
SYNTHETIC_SCOPE = "synthetic-mal-pfos-migration"
_SOURCE_MAJOR_RE = re.compile(r"\A([+-]?)(\d+)(?:\.(\d{1,3}))?\Z")
_ALLOWED_SOURCE_UNITS = frozenset({"EGP_MAJOR_DECIMAL_TEXT", "EGP_MILLIUNITS"})


class MigrationMapperError(ValueError):
    """Fail-closed synthetic migration validation error."""

    def __init__(self, code: str, field: str = "migration") -> None:
        self.code = code
        self.field = field
        super().__init__(f"synthetic migration refused {field}: {code}")


@dataclass(frozen=True, slots=True)
class LegacySchemaInventory:
    """Static schema/unit inventory; it never opens or reads a legacy ledger."""

    schema_ref: str
    schema_version: str
    fields: tuple[str, ...]
    monetary_fields: tuple[str, ...]
    source_units: tuple[str, ...]
    read_mode: str = "READ_ONLY_SYNTHETIC_INPUT"

    def __post_init__(self) -> None:
        if self.read_mode != "READ_ONLY_SYNTHETIC_INPUT":
            raise MigrationMapperError("SCHEMA_READ_MODE_INVALID", "read_mode")
        if not self.schema_ref.strip() or not self.schema_version.strip():
            raise MigrationMapperError("SCHEMA_ID_INVALID", "schema")
        if not self.fields or not self.monetary_fields:
            raise MigrationMapperError("SCHEMA_FIELDS_INCOMPLETE", "schema")
        if not set(self.monetary_fields) <= set(self.fields):
            raise MigrationMapperError("MONETARY_FIELD_NOT_IN_SCHEMA", "monetary_fields")
        if not self.source_units or not set(self.source_units) <= _ALLOWED_SOURCE_UNITS:
            raise MigrationMapperError("SOURCE_UNITS_INVALID", "source_units")


def inventory_legacy_mal_schema() -> LegacySchemaInventory:
    """Return the synthetic legacy schema map without reading a real source."""

    return LegacySchemaInventory(
        schema_ref="synthetic:mal/schema",
        schema_version="synthetic-v1",
        fields=("record_ref", "kind", "amount", "amount_unit", "currency", "source_version"),
        monetary_fields=("amount",),
        source_units=("EGP_MAJOR_DECIMAL_TEXT", "EGP_MILLIUNITS"),
    )


def _require_text(value: object, code: str, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise MigrationMapperError(code, field)
    return value.strip()


@dataclass(frozen=True, slots=True)
class LegacyMalRecord:
    """One synthetic legacy row; real ledger paths are intentionally not accepted."""

    record_ref: str
    kind: str
    amount: object
    amount_unit: str
    currency: str
    source_version: str

    def __post_init__(self) -> None:
        record_ref = _require_text(self.record_ref, "RECORD_REF_INVALID", "record_ref")
        if not record_ref.startswith("synthetic:mal/"):
            raise MigrationMapperError("SYNTHETIC_RECORD_REQUIRED", "record_ref")
        _require_text(self.kind, "RECORD_KIND_INVALID", "kind")
        if self.amount_unit not in _ALLOWED_SOURCE_UNITS:
            raise MigrationMapperError("SOURCE_UNIT_UNSUPPORTED", "amount_unit")
        _require_text(self.currency, "CURRENCY_INVALID", "currency")
        _require_text(self.source_version, "SOURCE_VERSION_INVALID", "source_version")
        # Validate at construction so an unsafe value cannot enter a staged record.
        _convert_amount(self.amount, self.amount_unit)


@dataclass(frozen=True, slots=True)
class PfosCandidate:
    """PFOS-shaped candidate data, explicitly marked as not canonical finance state."""

    candidate_ref: str
    source_ref: str
    kind: str
    amount_milliunits: int
    currency: str
    source_version: str
    unit: str = "milliunits"

    def __post_init__(self) -> None:
        if not self.candidate_ref.startswith("synthetic:pfos-candidate/"):
            raise MigrationMapperError("CANDIDATE_REF_INVALID", "candidate_ref")
        if not self.source_ref.startswith("synthetic:mal/"):
            raise MigrationMapperError("CANDIDATE_SOURCE_INVALID", "source_ref")
        _require_text(self.kind, "RECORD_KIND_INVALID", "kind")
        _require_text(self.currency, "CURRENCY_INVALID", "currency")
        _require_text(self.source_version, "SOURCE_VERSION_INVALID", "source_version")
        if self.unit != "milliunits":
            raise MigrationMapperError("CANDIDATE_UNIT_INVALID", "unit")
        try:
            validate_milliunits(self.amount_milliunits, "amount_milliunits")
        except MilliunitBoundaryError as error:
            raise MigrationMapperError(error.code, "amount_milliunits") from error


@dataclass(frozen=True, slots=True)
class SyntheticMigrationApproval:
    """A narrow in-memory scope proof; it grants no canonical write or cutover."""

    scope: str = SYNTHETIC_SCOPE
    read_only: bool = True
    synthetic_only: bool = True
    canonical_write: bool = False
    dual_write: bool = False
    cutover: bool = False

    def __post_init__(self) -> None:
        if self.scope != SYNTHETIC_SCOPE:
            raise MigrationMapperError("MIGRATION_SCOPE_INVALID", "scope")
        if not self.read_only or not self.synthetic_only:
            raise MigrationMapperError("SYNTHETIC_READ_ONLY_REQUIRED", "approval")
        if self.canonical_write or self.dual_write or self.cutover:
            raise MigrationMapperError("MIGRATION_EFFECT_FORBIDDEN", "approval")


@dataclass(frozen=True, slots=True)
class MigrationParityReceipt:
    """Content-addressed proof that candidates are staged only, with no writer effect."""

    status: str
    baseline_hash: str
    staged_hash: str
    expected_hash: str
    schema_ref: str
    schema_version: str
    source_units: tuple[str, ...]
    source_record_count: int
    candidate_record_count: int
    unexplained_records: tuple[str, ...]
    exact_milliunit_conversion: bool
    deterministic_output_parity: bool
    staged_only: bool = True
    legacy_source_unchanged: bool = True
    canonical_writer_changed: bool = False
    dual_write_started: bool = False
    cutover_performed: bool = False

    def __post_init__(self) -> None:
        if self.status not in {"AWAITING_HUMAN_CUTOVER", "REFUSED_PARITY_MISMATCH"}:
            raise MigrationMapperError("RECEIPT_STATUS_INVALID", "status")
        for field in ("baseline_hash", "staged_hash", "expected_hash"):
            value = getattr(self, field)
            if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
                raise MigrationMapperError("RECEIPT_HASH_INVALID", field)
        if self.source_record_count < 0 or self.candidate_record_count < 0:
            raise MigrationMapperError("RECEIPT_COUNT_INVALID", "receipt")
        if not self.staged_only or not self.legacy_source_unchanged:
            raise MigrationMapperError("RECEIPT_SAFETY_INVARIANT_FAILED", "receipt")
        if self.canonical_writer_changed or self.dual_write_started or self.cutover_performed:
            raise MigrationMapperError("RECEIPT_EFFECT_INVARIANT_FAILED", "receipt")

    def serialize(self) -> str:
        """Return deterministic JSON for a local evidence receipt."""

        return json.dumps(asdict(self), ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _convert_amount(amount: object, amount_unit: str) -> int:
    """Convert synthetic unit text exactly, then use the PFOS boundary validator."""

    if amount_unit == "EGP_MILLIUNITS":
        try:
            return parse_milliunits(amount, "legacy.amount")
        except MilliunitBoundaryError as error:
            raise MigrationMapperError(error.code, "amount") from error

    if amount_unit != "EGP_MAJOR_DECIMAL_TEXT" or not isinstance(amount, str):
        raise MigrationMapperError("LOSSLESS_AMOUNT_REQUIRED", "amount")
    match = _SOURCE_MAJOR_RE.fullmatch(amount.strip())
    if match is None:
        raise MigrationMapperError("LOSSLESS_AMOUNT_INVALID", "amount")
    sign, whole, fraction = match.groups()
    magnitude = int(whole) * MILLIUNITS_PER_EGP + int((fraction or "").ljust(3, "0"))
    converted = -magnitude if sign == "-" else magnitude
    try:
        return validate_milliunits(converted, "legacy.amount")
    except MilliunitBoundaryError as error:
        raise MigrationMapperError(error.code, "amount") from error


def map_synthetic_mal_to_pfos(records: Iterable[LegacyMalRecord]) -> tuple[PfosCandidate, ...]:
    """Map in-memory synthetic rows only; preserve input rows and never write a store."""

    materialized = tuple(records)
    seen: set[str] = set()
    candidates: list[PfosCandidate] = []
    for record in materialized:
        if not isinstance(record, LegacyMalRecord):
            raise MigrationMapperError("SYNTHETIC_RECORD_REQUIRED", "records")
        if record.record_ref in seen:
            raise MigrationMapperError("DUPLICATE_RECORD_REF", "record_ref")
        seen.add(record.record_ref)
        candidates.append(
            PfosCandidate(
                candidate_ref=f"synthetic:pfos-candidate/{record.record_ref.removeprefix('synthetic:mal/')}",
                source_ref=record.record_ref,
                kind=record.kind,
                amount_milliunits=_convert_amount(record.amount, record.amount_unit),
                currency=record.currency,
                source_version=record.source_version,
            )
        )
    return tuple(sorted(candidates, key=lambda candidate: candidate.candidate_ref))


def _canonical_candidates(candidates: Sequence[PfosCandidate]) -> str:
    rows = [
        {
            "amount_milliunits": candidate.amount_milliunits,
            "candidate_ref": candidate.candidate_ref,
            "currency": candidate.currency,
            "kind": candidate.kind,
            "source_ref": candidate.source_ref,
            "source_version": candidate.source_version,
            "unit": candidate.unit,
        }
        for candidate in sorted(candidates, key=lambda item: item.candidate_ref)
    ]
    return json.dumps(rows, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _hash_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _canonical_source(records: Sequence[LegacyMalRecord]) -> str:
    rows = [
        {
            "amount": record.amount,
            "amount_unit": record.amount_unit,
            "currency": record.currency,
            "kind": record.kind,
            "record_ref": record.record_ref,
            "source_version": record.source_version,
        }
        for record in sorted(records, key=lambda item: item.record_ref)
    ]
    return json.dumps(rows, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def stage_synthetic_mal_migration(
    records: Iterable[LegacyMalRecord],
    expected_candidates: Iterable[PfosCandidate],
    *,
    approval: SyntheticMigrationApproval | None = None,
    schema: LegacySchemaInventory | None = None,
) -> tuple[tuple[PfosCandidate, ...], MigrationParityReceipt]:
    """Stage a synthetic parity comparison and return candidates plus an evidence receipt.

    The expected candidates are a caller-supplied synthetic deterministic reference. They are
    compared byte-for-byte after canonical ordering; this function never invokes a provider or
    writes to PFOS. A mismatch is represented by a refusal receipt and an empty staged result.
    """

    if approval is None:
        raise MigrationMapperError("MIGRATION_APPROVAL_REQUIRED", "approval")
    if not isinstance(approval, SyntheticMigrationApproval):
        raise MigrationMapperError("MIGRATION_APPROVAL_INVALID", "approval")
    inventory = schema or inventory_legacy_mal_schema()
    materialized = tuple(records)
    expected = tuple(expected_candidates)
    if any(not isinstance(candidate, PfosCandidate) for candidate in expected):
        raise MigrationMapperError("EXPECTED_CANDIDATE_INVALID", "expected_candidates")
    candidates = map_synthetic_mal_to_pfos(materialized)
    baseline_hash = _hash_text(_canonical_source(materialized))
    staged_payload = _canonical_candidates(candidates)
    expected_payload = _canonical_candidates(expected)
    staged_hash = _hash_text(staged_payload)
    expected_hash = _hash_text(expected_payload)
    unexplained = tuple(
        sorted(
            {candidate.candidate_ref for candidate in candidates}
            ^ {candidate.candidate_ref for candidate in expected}
        )
    )
    exact = staged_payload == expected_payload and not unexplained
    receipt = MigrationParityReceipt(
        status="AWAITING_HUMAN_CUTOVER" if exact else "REFUSED_PARITY_MISMATCH",
        baseline_hash=baseline_hash,
        staged_hash=staged_hash,
        expected_hash=expected_hash,
        schema_ref=inventory.schema_ref,
        schema_version=inventory.schema_version,
        source_units=inventory.source_units,
        source_record_count=len(materialized),
        candidate_record_count=len(candidates) if exact else 0,
        unexplained_records=unexplained,
        exact_milliunit_conversion=all(
            candidate.amount_milliunits == _convert_amount(record.amount, record.amount_unit)
            for record, candidate in zip(
                sorted(materialized, key=lambda item: item.record_ref),
                candidates,
                strict=True,
            )
        ),
        deterministic_output_parity=exact,
    )
    return (candidates if exact else tuple(), receipt)


__all__ = [
    "MILLIUNITS_PER_EGP",
    "MigrationMapperError",
    "MigrationParityReceipt",
    "LegacyMalRecord",
    "LegacySchemaInventory",
    "PfosCandidate",
    "SYNTHETIC_SCOPE",
    "SyntheticMigrationApproval",
    "inventory_legacy_mal_schema",
    "map_synthetic_mal_to_pfos",
    "stage_synthetic_mal_migration",
]
