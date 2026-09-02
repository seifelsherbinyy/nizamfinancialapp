"""Immutable UPOI governance and evidence models.

Owning contract: UPOI tasks 1.1, 2.2, and 2.3; requirements 1.1, 1.2, 1.3, 1.4; design sections 6, 7.1, 7.4, 8.2, and 22.
The module is deliberately dependency-free and contains no money arithmetic, I/O, network access,
provider calls, or authority beyond validation of typed contract records.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
import re
from typing import Final, TypeAlias


class ContractValidationError(ValueError):
    """Raised when a UPOI contract record would violate a fail-closed invariant."""


class AuthorityClass(str, Enum):
    """The eight distinct authority classes defined by the UPOI design."""

    OWNER = "owner"
    GOVERNANCE = "governance"
    DETERMINISTIC_DOMAIN = "deterministic-domain"
    EXECUTION_RUNTIME = "execution-runtime"
    OPERATOR_INTERFACE = "operator-interface"
    CONTEXT = "context"
    ARCHIVE = "archive"
    EVIDENCE_ONLY = "evidence-only"


class EvidenceLabel(str, Enum):
    FACT = "FACT"
    VERIFIED_IMPLEMENTATION = "VERIFIED_IMPLEMENTATION"
    INFERENCE = "INFERENCE"
    ASSUMPTION = "ASSUMPTION"
    RECOMMENDATION = "RECOMMENDATION"


class PrivacyClass(str, Enum):
    PUBLIC = "public"
    PRIVATE = "private"
    SENSITIVE = "sensitive"
    STRICT_LOCAL_MAXIMUM = "strict_local_maximum"


class ConfidenceBand(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ObjectiveState(str, Enum):
    UNKNOWN = "UNKNOWN"
    BASELINED = "BASELINED"
    AT_RISK = "AT_RISK"
    IMPROVING = "IMPROVING"
    VERIFIED = "VERIFIED"
    FAILED = "FAILED"
    REGRESSED = "REGRESSED"
    BLOCKED_HUMAN = "BLOCKED_HUMAN"
    BLOCKED_DEPENDENCY = "BLOCKED_DEPENDENCY"


class ActionRisk(str, Enum):
    READ_ONLY = "READ_ONLY"
    LOCAL_REVERSIBLE = "LOCAL_REVERSIBLE"
    EXTERNAL_REVERSIBLE = "EXTERNAL_REVERSIBLE"
    HUMAN_GATED = "HUMAN_GATED"
    IRREVERSIBLE = "IRREVERSIBLE"


class GateKind(str, Enum):
    HUMAN = "HUMAN"
    DEPENDENCY = "DEPENDENCY"


class GateState(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"


class ExecutionOutcome(str, Enum):
    SUCCEEDED = "SUCCEEDED"
    REFUSED = "REFUSED"
    FAILED = "FAILED"
    BLOCKED = "BLOCKED"
    DUPLICATE_NO_OP = "DUPLICATE_NO_OP"


class BlockerKind(str, Enum):
    HUMAN_GATE = "HUMAN_GATE"
    DEPENDENCY = "DEPENDENCY"
    AUTHORITY = "AUTHORITY"
    PROVENANCE = "PROVENANCE"
    VALIDATION = "VALIDATION"
    VERIFICATION = "VERIFICATION"


Reference: TypeAlias = str
IdempotencyKey: TypeAlias = str
_SHA256_RE: Final[re.Pattern[str]] = re.compile(r"^[0-9a-f]{64}$")


def _text(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractValidationError(f"{field} must be a non-empty string")
    return value.strip()


def _reference(value: object, field: str = "reference") -> str:
    return _text(value, field)


def _sha256(value: object, field: str = "content_hash") -> str:
    if not isinstance(value, str) or _SHA256_RE.fullmatch(value) is None:
        raise ContractValidationError(f"{field} must be a lowercase SHA-256 digest")
    return value


def _utc(value: object, field: str) -> datetime:
    if not isinstance(value, datetime):
        raise ContractValidationError(f"{field} must be an aware UTC datetime")
    if value.tzinfo is None or value.utcoffset() != timedelta(0):
        raise ContractValidationError(f"{field} must be an aware UTC datetime")
    return value


def _enum(value: object, expected: type[Enum], field: str) -> None:
    if not isinstance(value, expected):
        raise ContractValidationError(f"{field} must be {expected.__name__}")


def _refs(values: tuple[str, ...], field: str, *, required: bool = True) -> None:
    if not isinstance(values, tuple):
        raise ContractValidationError(f"{field} must be a tuple of references")
    if required and not values:
        raise ContractValidationError(f"{field} must not be empty")
    for value in values:
        _reference(value, field)


def _checks(values: tuple[CheckDefinition, ...], field: str, *, required: bool = True) -> None:
    if not isinstance(values, tuple):
        raise ContractValidationError(f"{field} must be a tuple of CheckDefinition values")
    if required and not values:
        raise ContractValidationError(f"{field} must not be empty")
    if len({check.check_id for check in values}) != len(values):
        raise ContractValidationError(f"{field} must not contain duplicate check ids")
    for check in values:
        if not isinstance(check, CheckDefinition):
            raise ContractValidationError(f"{field} contains a non-check value")


@dataclass(frozen=True, slots=True)
class BaselineRef:
    """A content-addressed immutable baseline pointer."""

    reference: Reference
    content_hash: str
    version: str

    def __post_init__(self) -> None:
        _reference(self.reference, "reference")
        _sha256(self.content_hash)
        _text(self.version, "version")


@dataclass(frozen=True, slots=True)
class ProvenanceRecord:
    """Complete, non-authoritative provenance for a material evidence item."""

    source_ref: Reference
    source_version: str
    content_hash: str
    observed_at: datetime
    evidence_label: EvidenceLabel
    authority_class: AuthorityClass
    privacy_class: PrivacyClass
    confidence: ConfidenceBand

    def __post_init__(self) -> None:
        _reference(self.source_ref, "source_ref")
        _text(self.source_version, "source_version")
        _sha256(self.content_hash)
        _utc(self.observed_at, "observed_at")
        _enum(self.evidence_label, EvidenceLabel, "evidence_label")
        _enum(self.authority_class, AuthorityClass, "authority_class")
        _enum(self.privacy_class, PrivacyClass, "privacy_class")
        _enum(self.confidence, ConfidenceBand, "confidence")


@dataclass(frozen=True, slots=True)
class CheckDefinition:
    check_id: str
    description: str

    def __post_init__(self) -> None:
        _text(self.check_id, "check_id")
        _text(self.description, "description")


@dataclass(frozen=True, slots=True)
class EvidenceContract:
    contract_ref: Reference
    requirement_refs: tuple[Reference, ...]

    def __post_init__(self) -> None:
        _reference(self.contract_ref, "contract_ref")
        _refs(self.requirement_refs, "requirement_refs")


@dataclass(frozen=True, slots=True)
class GovernanceTrace:
    """The contract/requirement lineage carried from a plan into receipts."""

    contract_refs: tuple[Reference, ...]
    requirement_refs: tuple[Reference, ...]

    def __post_init__(self) -> None:
        _refs(self.contract_refs, "contract_refs")
        _refs(self.requirement_refs, "requirement_refs")


@dataclass(frozen=True, slots=True)
class TypedBlocker:
    """A bounded blocker with one explicit next action for the owner."""

    kind: BlockerKind
    code: str
    summary: str
    next_owner_action: str
    authority_class: AuthorityClass
    raised_at: datetime

    def __post_init__(self) -> None:
        _enum(self.kind, BlockerKind, "kind")
        _text(self.code, "code")
        _text(self.summary, "summary")
        _text(self.next_owner_action, "next_owner_action")
        _enum(self.authority_class, AuthorityClass, "authority_class")
        _utc(self.raised_at, "raised_at")


@dataclass(frozen=True, slots=True)
class LabeledFinding:
    label: EvidenceLabel
    summary: str
    provenance: tuple[ProvenanceRecord, ...]

    def __post_init__(self) -> None:
        _enum(self.label, EvidenceLabel, "label")
        _text(self.summary, "summary")
        if not self.provenance or not all(isinstance(item, ProvenanceRecord) for item in self.provenance):
            raise ContractValidationError("provenance must contain at least one ProvenanceRecord")


@dataclass(frozen=True, slots=True)
class ObjectiveDefinition:
    id: int
    name: str
    validation_question: str
    owner: AuthorityClass
    evidence_contract: EvidenceContract
    positive_checks: tuple[CheckDefinition, ...]
    negative_checks: tuple[CheckDefinition, ...]
    regression_checks: tuple[CheckDefinition, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.id, int) or isinstance(self.id, bool) or self.id <= 0:
            raise ContractValidationError("id must be a positive integer")
        _text(self.name, "name")
        _text(self.validation_question, "validation_question")
        _enum(self.owner, AuthorityClass, "owner")
        if not isinstance(self.evidence_contract, EvidenceContract):
            raise ContractValidationError("evidence_contract must be an EvidenceContract")
        _checks(self.positive_checks, "positive_checks")
        _checks(self.negative_checks, "negative_checks")
        _checks(self.regression_checks, "regression_checks")


@dataclass(frozen=True, slots=True)
class ObjectiveEvaluation:
    objective_id: int
    state: ObjectiveState
    baseline_ref: BaselineRef
    evidence_refs: tuple[Reference, ...]
    findings: tuple[LabeledFinding, ...]
    evaluated_at: datetime
    blockers: tuple[TypedBlocker, ...] = ()

    def __post_init__(self) -> None:
        if not isinstance(self.objective_id, int) or isinstance(self.objective_id, bool) or self.objective_id <= 0:
            raise ContractValidationError("objective_id must be a positive integer")
        _enum(self.state, ObjectiveState, "state")
        if not isinstance(self.baseline_ref, BaselineRef):
            raise ContractValidationError("baseline_ref must be a BaselineRef")
        _refs(self.evidence_refs, "evidence_refs", required=False)
        if not isinstance(self.findings, tuple) or not all(isinstance(item, LabeledFinding) for item in self.findings):
            raise ContractValidationError("findings must contain only LabeledFinding values")
        _utc(self.evaluated_at, "evaluated_at")
        if not isinstance(self.blockers, tuple) or not all(isinstance(item, TypedBlocker) for item in self.blockers):
            raise ContractValidationError("blockers must contain only TypedBlocker values")
        blocked = self.state in {ObjectiveState.BLOCKED_HUMAN, ObjectiveState.BLOCKED_DEPENDENCY}
        if blocked != bool(self.blockers):
            raise ContractValidationError("blocked objective states require typed blockers, and other states may not have them")


# The governance plane is the only authority allowed to delegate execution or domain access.
_ALLOWED_AUTHORITY_TRANSFERS: Final[frozenset[tuple[AuthorityClass, AuthorityClass]]] = frozenset(
    {
        (AuthorityClass.OWNER, AuthorityClass.GOVERNANCE),
        (AuthorityClass.GOVERNANCE, AuthorityClass.DETERMINISTIC_DOMAIN),
        (AuthorityClass.GOVERNANCE, AuthorityClass.EXECUTION_RUNTIME),
        (AuthorityClass.GOVERNANCE, AuthorityClass.OPERATOR_INTERFACE),
        (AuthorityClass.GOVERNANCE, AuthorityClass.CONTEXT),
        (AuthorityClass.GOVERNANCE, AuthorityClass.ARCHIVE),
        (AuthorityClass.GOVERNANCE, AuthorityClass.EVIDENCE_ONLY),
        (AuthorityClass.DETERMINISTIC_DOMAIN, AuthorityClass.EVIDENCE_ONLY),
        (AuthorityClass.CONTEXT, AuthorityClass.EVIDENCE_ONLY),
        (AuthorityClass.ARCHIVE, AuthorityClass.EVIDENCE_ONLY),
    }
)


@dataclass(frozen=True, slots=True)
class Grant:
    grant_id: str
    issuer: AuthorityClass
    recipient: AuthorityClass
    scope: tuple[Reference, ...]
    issued_at: datetime
    expires_at: datetime
    provenance: ProvenanceRecord
    idempotency_key: IdempotencyKey
    gate_id: str | None = None
    profile_id: str | None = None

    def __post_init__(self) -> None:
        _text(self.grant_id, "grant_id")
        _enum(self.issuer, AuthorityClass, "issuer")
        _enum(self.recipient, AuthorityClass, "recipient")
        if (self.issuer, self.recipient) not in _ALLOWED_AUTHORITY_TRANSFERS:
            raise ContractValidationError(
                f"unsupported authority transfer: {self.issuer.value} -> {self.recipient.value}"
            )
        _refs(self.scope, "scope")
        _utc(self.issued_at, "issued_at")
        _utc(self.expires_at, "expires_at")
        if self.expires_at <= self.issued_at:
            raise ContractValidationError("expires_at must be later than issued_at")
        if not isinstance(self.provenance, ProvenanceRecord):
            raise ContractValidationError("provenance must be a ProvenanceRecord")
        _text(self.idempotency_key, "idempotency_key")
        if self.gate_id is not None:
            _text(self.gate_id, "gate_id")
        if self.profile_id is not None:
            _text(self.profile_id, "profile_id")


@dataclass(frozen=True, slots=True)
class Gate:
    gate_id: str
    kind: GateKind
    scope: tuple[Reference, ...]
    requested_at: datetime
    state: GateState = GateState.PENDING
    approver: AuthorityClass | None = None
    decided_at: datetime | None = None
    decision_ref: Reference | None = None
    next_owner_action: str | None = None

    def __post_init__(self) -> None:
        _text(self.gate_id, "gate_id")
        _enum(self.kind, GateKind, "kind")
        _refs(self.scope, "scope")
        _utc(self.requested_at, "requested_at")
        _enum(self.state, GateState, "state")
        if self.approver is not None:
            _enum(self.approver, AuthorityClass, "approver")
        if self.decided_at is not None:
            _utc(self.decided_at, "decided_at")
        if self.decision_ref is not None:
            _reference(self.decision_ref, "decision_ref")
        if self.next_owner_action is not None:
            _text(self.next_owner_action, "next_owner_action")

        if self.kind is GateKind.HUMAN and self.state is GateState.APPROVED:
            if self.approver is not AuthorityClass.OWNER:
                raise ContractValidationError("a human gate can only be approved by the owner")
            if self.decided_at is None or self.decision_ref is None:
                raise ContractValidationError("an approved human gate requires decision time and reference")
        if self.state is GateState.PENDING and not self.next_owner_action:
            raise ContractValidationError("a pending gate requires one next_owner_action")
        if self.state in {GateState.REJECTED, GateState.EXPIRED} and not self.next_owner_action:
            raise ContractValidationError("a rejected or expired gate requires one next_owner_action")


@dataclass(frozen=True, slots=True)
class ActionPlan:
    plan_id: str
    intent: str
    target_authority: AuthorityClass
    risk: ActionRisk
    idempotency_key: IdempotencyKey
    required_grants: tuple[Grant, ...]
    human_gate: str | None
    preconditions: tuple[CheckDefinition, ...]
    postconditions: tuple[CheckDefinition, ...]
    rollback_ref: Reference | None
    governance_trace: GovernanceTrace
    required_grant_scopes: tuple[Reference, ...] = ()
    scope: tuple[Reference, ...] = ()

    def __post_init__(self) -> None:
        _text(self.plan_id, "plan_id")
        _text(self.intent, "intent")
        _enum(self.target_authority, AuthorityClass, "target_authority")
        _enum(self.risk, ActionRisk, "risk")
        _text(self.idempotency_key, "idempotency_key")
        if not isinstance(self.required_grants, tuple) or not all(isinstance(item, Grant) for item in self.required_grants):
            raise ContractValidationError("required_grants must contain only Grant values")
        if self.human_gate is not None:
            _text(self.human_gate, "human_gate")
        _checks(self.preconditions, "preconditions")
        _checks(self.postconditions, "postconditions")
        if self.rollback_ref is not None:
            _reference(self.rollback_ref, "rollback_ref")
        if not isinstance(self.governance_trace, GovernanceTrace):
            raise ContractValidationError("governance_trace must be a GovernanceTrace")
        _refs(self.required_grant_scopes, "required_grant_scopes", required=False)
        _refs(self.scope, "scope", required=False)
        if len(set(self.required_grant_scopes)) != len(self.required_grant_scopes):
            raise ContractValidationError("required_grant_scopes must not contain duplicates")

        if self.risk is not ActionRisk.READ_ONLY and self.rollback_ref is None:
            raise ContractValidationError("every consequential plan requires a rollback_ref")
        if self.risk in {ActionRisk.HUMAN_GATED, ActionRisk.IRREVERSIBLE} and self.human_gate is None:
            raise ContractValidationError("human-gated and irreversible plans require a human_gate")
        if self.target_authority is AuthorityClass.EVIDENCE_ONLY and self.risk is not ActionRisk.READ_ONLY:
            raise ContractValidationError("evidence-only authority cannot be an effect target")


@dataclass(frozen=True, slots=True)
class ExecutionReceipt:
    execution_ref: Reference
    plan_id: str
    idempotency_key: IdempotencyKey
    outcome: ExecutionOutcome
    effect_refs: tuple[Reference, ...]
    audit_ref: Reference
    executed_at: datetime
    governance_trace: GovernanceTrace
    blocker: TypedBlocker | None = None

    def __post_init__(self) -> None:
        _reference(self.execution_ref, "execution_ref")
        _text(self.plan_id, "plan_id")
        _text(self.idempotency_key, "idempotency_key")
        _enum(self.outcome, ExecutionOutcome, "outcome")
        _refs(self.effect_refs, "effect_refs", required=False)
        _reference(self.audit_ref, "audit_ref")
        _utc(self.executed_at, "executed_at")
        if not isinstance(self.governance_trace, GovernanceTrace):
            raise ContractValidationError("governance_trace must be a GovernanceTrace")
        if self.blocker is not None and not isinstance(self.blocker, TypedBlocker):
            raise ContractValidationError("blocker must be a TypedBlocker")
        if (self.outcome is ExecutionOutcome.BLOCKED) != (self.blocker is not None):
            raise ContractValidationError("BLOCKED execution receipts require exactly one typed blocker")


@dataclass(frozen=True, slots=True)
class VerificationReceipt:
    execution_ref: Reference
    observed_state_hash: str
    expected_state_hash: str
    matched: bool
    verified_at: datetime
    governance_trace: GovernanceTrace | None = None

    def __post_init__(self) -> None:
        _reference(self.execution_ref, "execution_ref")
        _sha256(self.observed_state_hash, "observed_state_hash")
        _sha256(self.expected_state_hash, "expected_state_hash")
        if not isinstance(self.matched, bool):
            raise ContractValidationError("matched must be a bool")
        _utc(self.verified_at, "verified_at")
        if self.governance_trace is not None and not isinstance(self.governance_trace, GovernanceTrace):
            raise ContractValidationError("governance_trace must be a GovernanceTrace")
        if self.matched and self.observed_state_hash != self.expected_state_hash:
            raise ContractValidationError("matched verification requires equal state hashes")


__all__ = [
    "ActionPlan",
    "ActionRisk",
    "AuthorityClass",
    "BaselineRef",
    "BlockerKind",
    "CheckDefinition",
    "ConfidenceBand",
    "ContractValidationError",
    "EvidenceContract",
    "EvidenceLabel",
    "ExecutionOutcome",
    "ExecutionReceipt",
    "Gate",
    "GateKind",
    "GateState",
    "GovernanceTrace",
    "Grant",
    "LabeledFinding",
    "ObjectiveDefinition",
    "ObjectiveEvaluation",
    "ObjectiveState",
    "PrivacyClass",
    "ProvenanceRecord",
    "TypedBlocker",
    "VerificationReceipt",
]
