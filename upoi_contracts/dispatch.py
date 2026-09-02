"""Offline bounded dispatch, audit receipts, verification, and replay safety.

Owning contract: UPOI task 2.3; requirement 1.3; design sections 6.1, 7.4,
9.1, and 19.3. This module is an injected, synthetic-only boundary. It has
no provider, network, persistence, secret, deployment, or financial authority;
PFOS remains the only financial authority.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
from enum import Enum
import hashlib
import json
from typing import Callable, Protocol

from .authorization import AuthorizedPlan
from .models import (
    ActionPlan,
    ContractValidationError,
    ExecutionOutcome,
    ExecutionReceipt,
    GovernanceTrace,
    VerificationReceipt,
    _reference,
    _sha256,
    _text,
    _utc,
)

_ZERO_HASH = "0" * 64


class DispatchCode(str, Enum):
    """Bounded public outcomes; none of these codes authorize a retry."""

    INVALID_PLAN = "INVALID_PLAN"
    IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT"
    EFFECT_LIMIT_EXCEEDED = "EFFECT_LIMIT_EXCEEDED"
    EXECUTION_UNKNOWN = "EXECUTION_UNKNOWN"
    VERIFICATION_UNKNOWN = "VERIFICATION_UNKNOWN"
    SAFE_REPLAY_BLOCKED = "SAFE_REPLAY_BLOCKED"


class AuditEventKind(str, Enum):
    EXECUTION = "EXECUTION"
    VERIFICATION = "VERIFICATION"
    EXECUTION_UNKNOWN = "EXECUTION_UNKNOWN"
    VERIFICATION_UNKNOWN = "VERIFICATION_UNKNOWN"
    SAFE_REPLAY = "SAFE_REPLAY"
    SAFE_REPLAY_BLOCKED = "SAFE_REPLAY_BLOCKED"


class DispatchError(RuntimeError):
    """A fail-closed dispatch result with any known receipt attached."""

    def __init__(
        self,
        code: DispatchCode,
        message: str,
        *,
        execution: ExecutionReceipt | None = None,
        verification: VerificationReceipt | None = None,
        cause: Exception | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.execution = execution
        self.verification = verification
        self.cause = cause


@dataclass(frozen=True, slots=True)
class DispatchEffect:
    """The target's bounded effect declaration and expected post-action state."""

    effect_refs: tuple[str, ...]
    expected_state: object

    def __post_init__(self) -> None:
        if not isinstance(self.effect_refs, tuple):
            raise ContractValidationError("effect_refs must be a tuple")
        for effect_ref in self.effect_refs:
            _reference(effect_ref, "effect_refs")
        if len(set(self.effect_refs)) != len(self.effect_refs):
            raise ContractValidationError("effect_refs must not contain duplicates")


class BoundedDispatchPort(Protocol):
    """Injected target boundary; implementations must be offline test doubles here."""

    def execute(self, plan: ActionPlan) -> DispatchEffect:
        ...

    def observe(self, plan: ActionPlan, receipt: ExecutionReceipt) -> object:
        ...


@dataclass(frozen=True, slots=True)
class AuditReceipt:
    """One immutable hash-linked audit event; the store exposes no update/delete API."""

    sequence: int
    audit_ref: str
    kind: AuditEventKind
    receipt_ref: str
    plan_id: str
    idempotency_key: str
    governance_trace: GovernanceTrace
    recorded_at: datetime
    previous_hash: str
    content_hash: str

    def __post_init__(self) -> None:
        if not isinstance(self.sequence, int) or isinstance(self.sequence, bool) or self.sequence <= 0:
            raise ContractValidationError("sequence must be a positive integer")
        _reference(self.audit_ref, "audit_ref")
        if not isinstance(self.kind, AuditEventKind):
            raise ContractValidationError("kind must be AuditEventKind")
        _reference(self.receipt_ref, "receipt_ref")
        _text(self.plan_id, "plan_id")
        _text(self.idempotency_key, "idempotency_key")
        if not isinstance(self.governance_trace, GovernanceTrace):
            raise ContractValidationError("governance_trace must be a GovernanceTrace")
        _utc(self.recorded_at, "recorded_at")
        _sha256(self.previous_hash, "previous_hash")
        _sha256(self.content_hash, "content_hash")


class AuditReceiptStore:
    """An in-memory append-only receipt chain for offline execution rehearsals."""

    def __init__(self) -> None:
        self._receipts: tuple[AuditReceipt, ...] = ()

    @property
    def receipts(self) -> tuple[AuditReceipt, ...]:
        return self._receipts

    @property
    def next_audit_ref(self) -> str:
        return f"audit:{len(self._receipts) + 1}"

    def append_execution(self, receipt: ExecutionReceipt, *, recorded_at: datetime) -> AuditReceipt:
        return self._append(
            AuditEventKind.EXECUTION,
            receipt.audit_ref,
            receipt.plan_id,
            receipt.idempotency_key,
            receipt.governance_trace,
            recorded_at,
        )

    def append_verification(
        self,
        receipt: VerificationReceipt,
        *,
        plan_id: str,
        idempotency_key: str,
        governance_trace: GovernanceTrace,
        recorded_at: datetime,
    ) -> AuditReceipt:
        return self._append(
            AuditEventKind.VERIFICATION,
            receipt.execution_ref,
            plan_id,
            idempotency_key,
            governance_trace,
            recorded_at,
        )

    def append_unknown(
        self,
        kind: AuditEventKind,
        *,
        receipt_ref: str,
        plan_id: str,
        idempotency_key: str,
        governance_trace: GovernanceTrace,
        recorded_at: datetime,
    ) -> AuditReceipt:
        if kind not in {AuditEventKind.EXECUTION_UNKNOWN, AuditEventKind.VERIFICATION_UNKNOWN}:
            raise ContractValidationError("unknown audit kind is required")
        return self._append(kind, receipt_ref, plan_id, idempotency_key, governance_trace, recorded_at)

    def append_replay(
        self,
        *,
        blocked: bool,
        receipt_ref: str,
        plan_id: str,
        idempotency_key: str,
        governance_trace: GovernanceTrace,
        recorded_at: datetime,
    ) -> AuditReceipt:
        return self._append(
            AuditEventKind.SAFE_REPLAY_BLOCKED if blocked else AuditEventKind.SAFE_REPLAY,
            receipt_ref,
            plan_id,
            idempotency_key,
            governance_trace,
            recorded_at,
        )

    def verify_chain(self) -> bool:
        previous = _ZERO_HASH
        for expected_sequence, receipt in enumerate(self._receipts, start=1):
            if receipt.sequence != expected_sequence or receipt.previous_hash != previous:
                return False
            if receipt.content_hash != _event_hash(receipt):
                return False
            previous = receipt.content_hash
        return True

    def _append(
        self,
        kind: AuditEventKind,
        receipt_ref: str,
        plan_id: str,
        idempotency_key: str,
        governance_trace: GovernanceTrace,
        recorded_at: datetime,
    ) -> AuditReceipt:
        if not isinstance(kind, AuditEventKind):
            raise ContractValidationError("kind must be AuditEventKind")
        if kind is AuditEventKind.EXECUTION and receipt_ref != self.next_audit_ref:
            raise ContractValidationError("execution audit_ref must be the next append-only reference")
        audit_ref = receipt_ref if kind is AuditEventKind.EXECUTION else self.next_audit_ref
        previous = self._receipts[-1].content_hash if self._receipts else _ZERO_HASH
        event = AuditReceipt(
            sequence=len(self._receipts) + 1,
            audit_ref=audit_ref,
            kind=kind,
            receipt_ref=receipt_ref,
            plan_id=plan_id,
            idempotency_key=idempotency_key,
            governance_trace=governance_trace,
            recorded_at=recorded_at,
            previous_hash=previous,
            content_hash=_ZERO_HASH,
        )
        event = replace(event, content_hash=_event_hash(event))
        self._receipts = self._receipts + (event,)
        return event


def _event_hash(receipt: AuditReceipt) -> str:
    payload = {
        "sequence": receipt.sequence,
        "audit_ref": receipt.audit_ref,
        "kind": receipt.kind.value,
        "receipt_ref": receipt.receipt_ref,
        "plan_id": receipt.plan_id,
        "idempotency_key": receipt.idempotency_key,
        "contract_refs": receipt.governance_trace.contract_refs,
        "requirement_refs": receipt.governance_trace.requirement_refs,
        "recorded_at": receipt.recorded_at.isoformat(),
        "previous_hash": receipt.previous_hash,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _state_hash(value: object) -> str:
    try:
        encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ValueError("state must be deterministically serializable") from exc
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _plan_fingerprint(plan: AuthorizedPlan) -> str:
    action = plan.plan
    payload = {
        "plan_id": action.plan_id,
        "intent": action.intent,
        "target_authority": action.target_authority.value,
        "risk": action.risk.value,
        "idempotency_key": action.idempotency_key,
        "scope": action.scope,
        "required_grant_scopes": action.required_grant_scopes,
        "human_gate": action.human_gate,
        "rollback_ref": action.rollback_ref,
        "profile_id": plan.profile_id,
        "contract_refs": action.governance_trace.contract_refs,
        "requirement_refs": action.governance_trace.requirement_refs,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@dataclass(frozen=True, slots=True)
class DispatchResult:
    execution: ExecutionReceipt
    verification: VerificationReceipt | None
    replayed: bool = False

    def __post_init__(self) -> None:
        if not isinstance(self.execution, ExecutionReceipt):
            raise ContractValidationError("execution must be an ExecutionReceipt")
        if self.verification is not None:
            if not isinstance(self.verification, VerificationReceipt):
                raise ContractValidationError("verification must be a VerificationReceipt")
            if self.verification.execution_ref != self.execution.execution_ref:
                raise ContractValidationError("verification must reference execution")
        if not isinstance(self.replayed, bool):
            raise ContractValidationError("replayed must be a bool")


@dataclass(frozen=True, slots=True)
class _DispatchRecord:
    fingerprint: str
    result: DispatchResult


class BoundedDispatcher:
    """Dispatch authorized plans once, then verify; retries are receipt lookups only."""

    def __init__(
        self,
        target: BoundedDispatchPort,
        audit: AuditReceiptStore | None = None,
        *,
        max_effect_refs: int = 1,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        if not hasattr(target, "execute") or not hasattr(target, "observe"):
            raise ContractValidationError("target must implement execute and observe")
        if not isinstance(max_effect_refs, int) or isinstance(max_effect_refs, bool) or max_effect_refs <= 0:
            raise ContractValidationError("max_effect_refs must be a positive integer")
        self._target = target
        self._audit = audit or AuditReceiptStore()
        self._max_effect_refs = max_effect_refs
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._records: tuple[_DispatchRecord, ...] = ()

    @property
    def audit(self) -> AuditReceiptStore:
        return self._audit

    @property
    def records(self) -> tuple[DispatchResult, ...]:
        return tuple(record.result for record in self._records)

    def dispatch(self, authorized_plan: AuthorizedPlan) -> DispatchResult:
        if not isinstance(authorized_plan, AuthorizedPlan):
            raise DispatchError(DispatchCode.INVALID_PLAN, "dispatch requires an authorized plan")
        plan = authorized_plan.plan
        key = plan.idempotency_key
        fingerprint = _plan_fingerprint(authorized_plan)
        prior = next((record for record in self._records if record.result.execution.idempotency_key == key), None)
        if prior is not None:
            now = self._now()
            if prior.fingerprint != fingerprint:
                self._audit.append_replay(
                    blocked=True,
                    receipt_ref=prior.result.execution.execution_ref,
                    plan_id=plan.plan_id,
                    idempotency_key=key,
                    governance_trace=plan.governance_trace,
                    recorded_at=now,
                )
                raise DispatchError(DispatchCode.IDEMPOTENCY_CONFLICT, "idempotency key is bound to another plan", execution=prior.result.execution, verification=prior.result.verification)
            blocked = prior.result.verification is None
            self._audit.append_replay(
                blocked=blocked,
                receipt_ref=prior.result.execution.execution_ref,
                plan_id=plan.plan_id,
                idempotency_key=key,
                governance_trace=plan.governance_trace,
                recorded_at=now,
            )
            if blocked:
                raise DispatchError(DispatchCode.SAFE_REPLAY_BLOCKED, "verification is unknown; replay is refused", execution=prior.result.execution)
            return replace(prior.result, replayed=True)

        try:
            effect = self._target.execute(plan)
            self._validate_effect(effect)
        except DispatchError as exc:
            execution = self._record_unknown(authorized_plan, ExecutionOutcome.FAILED, AuditEventKind.EXECUTION_UNKNOWN)
            result = DispatchResult(execution, None)
            self._records = self._records + (_DispatchRecord(fingerprint, result),)
            raise DispatchError(exc.code, str(exc), execution=execution, cause=exc) from exc
        except Exception as exc:
            execution = self._record_unknown(authorized_plan, ExecutionOutcome.FAILED, AuditEventKind.EXECUTION_UNKNOWN)
            result = DispatchResult(execution, None)
            self._records = self._records + (_DispatchRecord(fingerprint, result),)
            raise DispatchError(DispatchCode.EXECUTION_UNKNOWN, "execution outcome is unknown; replay is refused", execution=execution, cause=exc) from exc

        execution = self._new_execution(authorized_plan, effect.effect_refs, ExecutionOutcome.SUCCEEDED)
        self._audit.append_execution(execution, recorded_at=self._now())
        try:
            expected_hash = _state_hash(effect.expected_state)
            observed_hash = _state_hash(self._target.observe(plan, execution))
        except Exception as exc:
            self._audit.append_unknown(
                AuditEventKind.VERIFICATION_UNKNOWN,
                receipt_ref=execution.execution_ref,
                plan_id=plan.plan_id,
                idempotency_key=key,
                governance_trace=plan.governance_trace,
                recorded_at=self._now(),
            )
            result = DispatchResult(execution, None)
            self._records = self._records + (_DispatchRecord(fingerprint, result),)
            raise DispatchError(DispatchCode.VERIFICATION_UNKNOWN, "post-action state is unknown; replay is refused", execution=execution, cause=exc) from exc

        verification = VerificationReceipt(
            execution_ref=execution.execution_ref,
            observed_state_hash=observed_hash,
            expected_state_hash=expected_hash,
            matched=observed_hash == expected_hash,
            verified_at=self._now(),
            governance_trace=plan.governance_trace,
        )
        self._audit.append_verification(
            verification,
            plan_id=plan.plan_id,
            idempotency_key=key,
            governance_trace=plan.governance_trace,
            recorded_at=self._now(),
        )
        result = DispatchResult(execution, verification)
        self._records = self._records + (_DispatchRecord(fingerprint, result),)
        return result

    def _validate_effect(self, effect: object) -> None:
        if not isinstance(effect, DispatchEffect):
            raise ContractValidationError("target must return DispatchEffect")
        if len(effect.effect_refs) > self._max_effect_refs:
            raise DispatchError(DispatchCode.EFFECT_LIMIT_EXCEEDED, "target exceeded the bounded effect limit")

    def _new_execution(self, authorized_plan: AuthorizedPlan, effect_refs: tuple[str, ...], outcome: ExecutionOutcome) -> ExecutionReceipt:
        plan = authorized_plan.plan
        audit_ref = self._audit.next_audit_ref
        return ExecutionReceipt(
            execution_ref=f"execution:{len(self._records) + 1}",
            plan_id=plan.plan_id,
            idempotency_key=plan.idempotency_key,
            outcome=outcome,
            effect_refs=effect_refs,
            audit_ref=audit_ref,
            executed_at=self._now(),
            governance_trace=plan.governance_trace,
        )

    def _record_unknown(self, authorized_plan: AuthorizedPlan, outcome: ExecutionOutcome, kind: AuditEventKind) -> ExecutionReceipt:
        execution = self._new_execution(authorized_plan, (), outcome)
        self._audit.append_execution(execution, recorded_at=self._now())
        self._audit.append_unknown(
            kind,
            receipt_ref=execution.execution_ref,
            plan_id=execution.plan_id,
            idempotency_key=execution.idempotency_key,
            governance_trace=execution.governance_trace,
            recorded_at=self._now(),
        )
        return execution

    def _now(self) -> datetime:
        value = self._clock()
        _utc(value, "clock value")
        return value


__all__ = [
    "AuditEventKind",
    "AuditReceipt",
    "AuditReceiptStore",
    "BoundedDispatchPort",
    "BoundedDispatcher",
    "DispatchCode",
    "DispatchEffect",
    "DispatchError",
    "DispatchResult",
]
