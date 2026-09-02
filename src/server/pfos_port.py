"""
NIZAM · Injected deterministic PFOS boundary
Owning contract: UPOI design §6.2, §7.5, §11.1; PFOS Contract 06 §4.3
Phase: UPOI task 3.2

This module is an adapter boundary, not a financial engine. The injected source is the
existing authoritative PFOS implementation. This module validates and serializes already-produced
milliunit values, but never calculates, estimates, synthesizes, or writes monetary values.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping as MappingABC
from dataclasses import dataclass
from typing import Any, Mapping, Protocol, TypeAlias


MAX_SAFE_MILLIUNITS = 2**53 - 1
_INTEGER_TEXT = re.compile(r"-?(?:0|[1-9][0-9]*)\Z")


class MilliunitBoundaryError(ValueError):
    """Fail-closed validation or serialization error at a money boundary."""

    def __init__(self, code: str, field: str) -> None:
        self.code = code
        self.field = field
        super().__init__(f"milliunit boundary refused {field}: {code}")


def validate_milliunits(value: object, field: str = "milliunits") -> int:
    """Accept only a Python safe integer; never coerce floats, booleans, or decimals."""

    if type(value) is not int:
        code = "MILLIUNITS_FLOAT_FORBIDDEN" if isinstance(value, float) else "MILLIUNITS_NOT_INTEGER"
        raise MilliunitBoundaryError(code, field)
    if value < -MAX_SAFE_MILLIUNITS or value > MAX_SAFE_MILLIUNITS:
        raise MilliunitBoundaryError("MILLIUNITS_OUT_OF_SAFE_RANGE", field)
    return value


def parse_milliunits(value: object, field: str = "milliunits") -> int:
    """Parse only an exact integer representation at a machine boundary.

    Integer JSON values and canonical signed decimal text are accepted. Whitespace,
    grouping, fractions, exponent notation, booleans, and floating-point values are
    refused instead of being rounded or truncated.
    """

    if type(value) is int:
        return validate_milliunits(value, field)
    if not isinstance(value, str) or _INTEGER_TEXT.fullmatch(value) is None:
        raise MilliunitBoundaryError("MILLIUNITS_TEXT_INVALID", field)
    try:
        parsed = int(value, 10)
    except ValueError as error:
        raise MilliunitBoundaryError("MILLIUNITS_TEXT_INVALID", field) from error
    return validate_milliunits(parsed, field)


def serialize_milliunits(value: object, field: str = "milliunits") -> str:
    """Serialize one validated milliunit value without a floating-point hop."""

    return str(validate_milliunits(value, field))


def _validate_wire_key(key: object, field: str) -> str:
    if not isinstance(key, str) or key == "":
        raise MilliunitBoundaryError("MILLIUNITS_KEY_INVALID", field)
    return key


def serialize_milliunit_envelope(values: Mapping[str, object]) -> str:
    """Encode a milliunit map as canonical JSON integer text values.

    Strings on the wire avoid JavaScript number precision changes while the adapter
    returns Python integers to the PFOS port. This function validates only; it does
    not calculate, normalize, or persist a financial value.
    """

    if not isinstance(values, MappingABC):
        raise MilliunitBoundaryError("MILLIUNITS_ENVELOPE_INVALID", "values")
    encoded: dict[str, str] = {}
    for key, value in values.items():
        wire_key = _validate_wire_key(key, "values.key")
        encoded[wire_key] = serialize_milliunits(value, f"values.{wire_key}")
    return json.dumps(encoded, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False)


def _reject_json_constant(value: str) -> Any:
    raise MilliunitBoundaryError("JSON_NON_FINITE_NUMBER", "payload")


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise MilliunitBoundaryError("JSON_DUPLICATE_KEY", key)
        result[key] = value
    return result


def _parse_json_object(payload: str) -> dict[str, Any]:
    if not isinstance(payload, str):
        raise MilliunitBoundaryError("JSON_PAYLOAD_INVALID", "payload")
    try:
        parsed = json.loads(
            payload,
            parse_constant=_reject_json_constant,
            object_pairs_hook=_reject_duplicate_json_keys,
        )
    except MilliunitBoundaryError:
        raise
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise MilliunitBoundaryError("JSON_PAYLOAD_INVALID", "payload") from error
    if not isinstance(parsed, dict):
        raise MilliunitBoundaryError("JSON_ENVELOPE_INVALID", "payload")
    return parsed


def parse_milliunit_envelope(payload: str) -> dict[str, int]:
    """Decode a strict milliunit map, refusing any non-integer wire value."""

    parsed = _parse_json_object(payload)
    result: dict[str, int] = {}
    for key, value in parsed.items():
        wire_key = _validate_wire_key(key, "values.key")
        result[wire_key] = parse_milliunits(value, f"values.{wire_key}")
    return result


@dataclass(frozen=True)
class SignedFlow:
    """A validated flow: amount is signed; outflow/inflow are magnitudes."""

    amount: int
    outflow: int
    inflow: int

    def __post_init__(self) -> None:
        validate_milliunits(self.amount, "amount")
        validate_milliunits(self.outflow, "outflow")
        validate_milliunits(self.inflow, "inflow")
        if self.outflow < 0 or self.inflow < 0:
            raise MilliunitBoundaryError("SIGNED_FLOW_MAGNITUDE_NEGATIVE", "outflow/inflow")
        if self.amount < 0 and (self.outflow != -self.amount or self.inflow != 0):
            raise MilliunitBoundaryError("SIGNED_FLOW_CONVENTION_MISMATCH", "amount")
        if self.amount > 0 and (self.inflow != self.amount or self.outflow != 0):
            raise MilliunitBoundaryError("SIGNED_FLOW_CONVENTION_MISMATCH", "amount")
        if self.amount == 0 and (self.outflow != 0 or self.inflow != 0):
            raise MilliunitBoundaryError("SIGNED_FLOW_CONVENTION_MISMATCH", "amount")


def parse_signed_flow(payload: str) -> SignedFlow:
    """Decode a signed-flow envelope without deriving or rewriting its values."""

    values = parse_milliunit_envelope(payload)
    if set(values) != {"amount", "outflow", "inflow"}:
        raise MilliunitBoundaryError("SIGNED_FLOW_ENVELOPE_INVALID", "flow")
    return SignedFlow(amount=values["amount"], outflow=values["outflow"], inflow=values["inflow"])


def serialize_signed_flow(flow: SignedFlow) -> str:
    """Serialize a previously validated signed flow exactly."""

    if not isinstance(flow, SignedFlow):
        raise MilliunitBoundaryError("SIGNED_FLOW_INVALID", "flow")
    return serialize_milliunit_envelope({"amount": flow.amount, "outflow": flow.outflow, "inflow": flow.inflow})


class NonAuthoritativeExplanationError(ValueError):
    """Refusal when explanatory text crosses into an authoritative boundary."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(f"non-authoritative explanation boundary refused: {code}")


@dataclass(frozen=True, slots=True)
class NonAuthoritativeExplanation:
    """Model/Hermes text plus PFOS references, never financial data.

    This value is a reply-layer projection only. It deliberately has no values,
    decision, or persistence representation, and the explicit boundary methods
    fail closed if a caller tries to use it as one.
    """

    text: str
    cited_result_refs: tuple[str, ...]
    authority_class: str = "EVIDENCE_ONLY"

    def __post_init__(self) -> None:
        if not isinstance(self.text, str) or not self.text.strip():
            raise NonAuthoritativeExplanationError("EXPLANATION_TEXT_INVALID")
        if not self.cited_result_refs or any(
            not isinstance(reference, str) or not reference.strip()
            for reference in self.cited_result_refs
        ):
            raise NonAuthoritativeExplanationError("EXPLANATION_CITATIONS_REQUIRED")
        if self.authority_class != "EVIDENCE_ONLY":
            raise NonAuthoritativeExplanationError("EXPLANATION_AUTHORITY_INVALID")

    def render_reply(self) -> str:
        """Render a cited reply without adding or transforming financial values."""

        citations = ", ".join(self.cited_result_refs)
        return f"{self.text.strip()}\nCitations: {citations}"

    def as_persistence_input(self) -> object:
        """Reject persistence use; explanations are not durable domain state."""

        raise NonAuthoritativeExplanationError("EXPLANATION_PERSISTENCE_FORBIDDEN")

    def as_decision_input(self) -> object:
        """Reject decision use; explanations cannot influence PFOS evaluation."""

        raise NonAuthoritativeExplanationError("EXPLANATION_DECISION_INPUT_FORBIDDEN")


def _contains_non_authoritative_explanation(value: object) -> bool:
    if isinstance(value, NonAuthoritativeExplanation):
        return True
    if isinstance(value, MappingABC):
        return any(_contains_non_authoritative_explanation(item) for item in value.values())
    if isinstance(value, (list, tuple, set, frozenset)):
        return any(_contains_non_authoritative_explanation(item) for item in value)
    return False


@dataclass(frozen=True)
class FinanceQuery:
    """Bounded query passed unchanged to the authoritative PFOS source."""

    query_ref: str
    filters: Mapping[str, object]


@dataclass(frozen=True)
class FinanceDecisionRequest:
    """Decision request passed unchanged to deterministic PFOS logic."""

    request_ref: str
    inputs: Mapping[str, object]

    def __post_init__(self) -> None:
        if _contains_non_authoritative_explanation(self.inputs):
            raise NonAuthoritativeExplanationError("EXPLANATION_DECISION_INPUT_FORBIDDEN")


@dataclass(frozen=True)
class ProvenanceRecord:
    """Source references returned by PFOS and preserved by this boundary."""

    source_ref: str
    source_version: str
    observed_at: str
    content_hash: str


@dataclass(frozen=True)
class FinancialSnapshot:
    """A PFOS-produced snapshot; values are validated only at this adapter boundary."""

    version_ref: str
    observed_at: str
    values: Mapping[str, int]
    provenance: ProvenanceRecord


def validate_financial_snapshot(snapshot: FinancialSnapshot) -> FinancialSnapshot:
    """Validate PFOS output while preserving the source object and provenance references."""

    if not isinstance(snapshot, FinancialSnapshot):
        raise MilliunitBoundaryError("PFOS_SNAPSHOT_INVALID", "snapshot")
    if not isinstance(snapshot.values, MappingABC):
        raise MilliunitBoundaryError("PFOS_SNAPSHOT_VALUES_INVALID", "snapshot.values")
    for key, value in snapshot.values.items():
        wire_key = _validate_wire_key(key, "snapshot.values.key")
        validate_milliunits(value, f"snapshot.values.{wire_key}")
    return snapshot


def serialize_financial_snapshot(snapshot: FinancialSnapshot) -> str:
    """Serialize PFOS snapshot values exactly for browser/server/archive envelopes."""

    validated = validate_financial_snapshot(snapshot)
    provenance = validated.provenance
    body = {
        "observed_at": validated.observed_at,
        "provenance": {
            "content_hash": provenance.content_hash,
            "observed_at": provenance.observed_at,
            "source_ref": provenance.source_ref,
            "source_version": provenance.source_version,
        },
        "values": json.loads(serialize_milliunit_envelope(validated.values)),
        "version_ref": validated.version_ref,
    }
    return json.dumps(body, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False)


def deserialize_financial_snapshot(payload: str) -> FinancialSnapshot:
    """Parse a PFOS snapshot envelope and refuse malformed or lossy values."""

    body = _parse_json_object(payload)
    required = {"observed_at", "provenance", "values", "version_ref"}
    if set(body) != required:
        raise MilliunitBoundaryError("PFOS_SNAPSHOT_ENVELOPE_INVALID", "snapshot")
    provenance_raw = body["provenance"]
    if not isinstance(provenance_raw, dict) or set(provenance_raw) != {
        "content_hash",
        "observed_at",
        "source_ref",
        "source_version",
    }:
        raise MilliunitBoundaryError("PFOS_PROVENANCE_INVALID", "snapshot.provenance")
    if not all(isinstance(body[field], str) for field in ("observed_at", "version_ref")):
        raise MilliunitBoundaryError("PFOS_SNAPSHOT_METADATA_INVALID", "snapshot")
    if not all(isinstance(provenance_raw[field], str) for field in provenance_raw):
        raise MilliunitBoundaryError("PFOS_PROVENANCE_INVALID", "snapshot.provenance")
    values_raw = body["values"]
    if not isinstance(values_raw, dict):
        raise MilliunitBoundaryError("PFOS_SNAPSHOT_VALUES_INVALID", "snapshot.values")
    values: dict[str, int] = {}
    for key, value in values_raw.items():
        wire_key = _validate_wire_key(key, "snapshot.values.key")
        values[wire_key] = parse_milliunits(value, f"snapshot.values.{wire_key}")
    return FinancialSnapshot(
        version_ref=body["version_ref"],
        observed_at=body["observed_at"],
        values=values,
        provenance=ProvenanceRecord(
            source_ref=provenance_raw["source_ref"],
            source_version=provenance_raw["source_version"],
            observed_at=provenance_raw["observed_at"],
            content_hash=provenance_raw["content_hash"],
        ),
    )


@dataclass(frozen=True)
class FinanceDecisionResult:
    """A PFOS-produced decision; this adapter does not interpret its payload."""

    result_ref: str
    source_version: str
    decision: Mapping[str, object]
    provenance: ProvenanceRecord


# Alias matching the design vocabulary without introducing a second result shape.
FinancialDecisionResult: TypeAlias = FinanceDecisionResult


def compose_non_authoritative_explanation(
    result: FinancialSnapshot | FinanceDecisionResult,
    text: str,
) -> NonAuthoritativeExplanation:
    """Compose reply-layer text while citing only deterministic PFOS result references."""

    if isinstance(result, FinancialSnapshot):
        validate_financial_snapshot(result)
        result_ref = result.version_ref
    elif isinstance(result, FinanceDecisionResult):
        result_ref = result.result_ref
    else:
        raise NonAuthoritativeExplanationError("EXPLANATION_RESULT_INVALID")
    if not isinstance(result_ref, str) or not result_ref.strip():
        raise NonAuthoritativeExplanationError("EXPLANATION_RESULT_REF_INVALID")
    return NonAuthoritativeExplanation(text=text, cited_result_refs=(result_ref,))


class AuthoritativePfosSource(Protocol):
    """The only dependency this adapter may use for financial truth.

    A concrete implementation is injected by the caller. It owns all deterministic
    calculation and canonical financial reads/writes; this protocol adds no implementation.
    """

    def read_financial_snapshot(self, query: FinanceQuery) -> FinancialSnapshot:
        """Read a deterministic PFOS snapshot."""

    def evaluate_decision(self, request: FinanceDecisionRequest) -> FinanceDecisionResult:
        """Evaluate a decision using deterministic PFOS logic."""


class FinancePortError(RuntimeError):
    """Typed failure from the deterministic finance boundary."""

    code: str
    operation: str

    def __init__(self, code: str, operation: str) -> None:
        self.code = code
        self.operation = operation
        super().__init__(f"deterministic finance operation refused: {code}")


class FinanceSourceUnavailableError(FinancePortError):
    """Fail-closed refusal when authoritative PFOS cannot be reached."""

    def __init__(self, operation: str) -> None:
        super().__init__("PFOS_SOURCE_UNAVAILABLE", operation)


class DeterministicFinancePort:
    """Injected read/decision adapter for the existing authoritative PFOS source.

    The port deliberately returns the exact objects supplied by PFOS. In particular,
    source version and provenance references are not regenerated or inferred here.
    When no source is injected, or the source reports typed unavailability, the call
    refuses; there is no estimate, fixture fallback, model fallback, or archive fallback.
    """

    def __init__(self, source: AuthoritativePfosSource | None) -> None:
        self._source = source

    def read_financial_snapshot(self, query: FinanceQuery) -> FinancialSnapshot:
        source = self._require_source("read_financial_snapshot")
        try:
            return validate_financial_snapshot(source.read_financial_snapshot(query))
        except FinanceSourceUnavailableError as error:
            raise FinanceSourceUnavailableError("read_financial_snapshot") from error

    def evaluate_decision(self, request: FinanceDecisionRequest) -> FinanceDecisionResult:
        source = self._require_source("evaluate_decision")
        try:
            return source.evaluate_decision(request)
        except FinanceSourceUnavailableError as error:
            raise FinanceSourceUnavailableError("evaluate_decision") from error

    def compose_explanation(
        self,
        result: FinancialSnapshot | FinanceDecisionResult,
        text: str,
    ) -> NonAuthoritativeExplanation:
        """Compose a non-authoritative cited explanation from an existing PFOS result."""

        return compose_non_authoritative_explanation(result, text)

    def _require_source(self, operation: str) -> AuthoritativePfosSource:
        if self._source is None:
            raise FinanceSourceUnavailableError(operation)
        return self._source


__all__ = [
    "AuthoritativePfosSource",
    "DeterministicFinancePort",
    "FinanceDecisionRequest",
    "FinancePortError",
    "FinanceQuery",
    "FinanceSourceUnavailableError",
    "FinancialDecisionResult",
    "FinancialSnapshot",
    "MAX_SAFE_MILLIUNITS",
    "MilliunitBoundaryError",
    "NonAuthoritativeExplanation",
    "NonAuthoritativeExplanationError",
    "ProvenanceRecord",
    "SignedFlow",
    "compose_non_authoritative_explanation",
    "deserialize_financial_snapshot",
    "parse_milliunit_envelope",
    "parse_milliunits",
    "parse_signed_flow",
    "serialize_financial_snapshot",
    "serialize_milliunit_envelope",
    "serialize_milliunits",
    "serialize_signed_flow",
    "validate_financial_snapshot",
    "validate_milliunits",
]
