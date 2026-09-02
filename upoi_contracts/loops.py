"""Immutable UPOI baselines, evidence chains, and complete-loop control.

Owning contract: UPOI task 1.3; requirements 1.3; design sections 9.2, 10.2,
14.2, and 18. This module is dependency-free, offline-only, and contains no
persistence, network, provider, deployment, secret, or financial behavior.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
import hashlib
import json
from typing import Iterable, Mapping, Sequence

from .models import (
    BaselineRef,
    CheckDefinition,
    ContractValidationError,
    ObjectiveState,
    Reference,
    TypedBlocker,
    _refs,
    _reference,
    _sha256,
    _text,
    _utc,
)

_ZERO_HASH = "0" * 64


class LoopState(str, Enum):
    PROPOSED = "PROPOSED"
    BASELINED = "BASELINED"
    EXECUTING = "EXECUTING"
    VERIFYING = "VERIFYING"
    PASSED = "PASSED"
    FAILED = "FAILED"
    REGRESSED = "REGRESSED"
    BLOCKED = "BLOCKED"
    BLOCKED_HUMAN = "BLOCKED_HUMAN"
    BLOCKED_DEPENDENCY = "BLOCKED_DEPENDENCY"
    ROLLED_BACK = "ROLLED_BACK"


class EvidenceEventKind(str, Enum):
    BASELINE_FROZEN = "BASELINE_FROZEN"
    CHECK_OBSERVED = "CHECK_OBSERVED"
    DASHBOARD_RERUN = "DASHBOARD_RERUN"
    LOOP_CLOSED = "LOOP_CLOSED"


def _canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _digest(value: object) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _string_tuple(values: Sequence[object], field: str, *, required: bool = True) -> tuple[str, ...]:
    if not isinstance(values, tuple):
        raise ContractValidationError(f"{field} must be a tuple of references")
    if required and not values:
        raise ContractValidationError(f"{field} must not be empty")
    result = tuple(_reference(value, field) for value in values)
    if len(set(result)) != len(result):
        raise ContractValidationError(f"{field} must not contain duplicates")
    return result


def _hash_tuple(values: Sequence[object], field: str) -> tuple[str, ...]:
    if not isinstance(values, tuple) or not values:
        raise ContractValidationError(f"{field} must contain at least one hash")
    return tuple(_sha256(value, field) for value in values)


def _checks(values: Sequence[object], field: str) -> tuple[CheckDefinition, ...]:
    if not isinstance(values, tuple) or not values:
        raise ContractValidationError(f"{field} must contain at least one check")
    if not all(isinstance(value, CheckDefinition) for value in values):
        raise ContractValidationError(f"{field} must contain only CheckDefinition values")
    checks = tuple(values)
    if len({check.check_id for check in checks}) != len(checks):
        raise ContractValidationError(f"{field} must not contain duplicate check ids")
    return checks


def _scope(values: Sequence[object], field: str) -> tuple[str, ...]:
    result = _string_tuple(values, field)
    if any(value in {"*", "all", "unbounded"} for value in result):
        raise ContractValidationError(f"{field} must be explicitly bounded")
    return result


@dataclass(frozen=True, slots=True)
class BaselineManifest:
    """A complete, content-addressed manifest that cannot be rewritten."""

    baseline_id: str
    version: str
    source_revision_refs: tuple[str, ...]
    check_inventory: tuple[CheckDefinition, ...]
    contract_refs: tuple[str, ...]
    spec_hashes: tuple[str, ...]
    schema_versions: tuple[str, ...]
    fixture_versions: tuple[str, ...]
    created_at: datetime
    content_hash: str

    def __post_init__(self) -> None:
        _text(self.baseline_id, "baseline_id")
        _text(self.version, "version")
        _string_tuple(self.source_revision_refs, "source_revision_refs")
        _checks(self.check_inventory, "check_inventory")
        _string_tuple(self.contract_refs, "contract_refs")
        _hash_tuple(self.spec_hashes, "spec_hashes")
        _string_tuple(self.schema_versions, "schema_versions")
        _string_tuple(self.fixture_versions, "fixture_versions")
        _utc(self.created_at, "created_at")
        _sha256(self.content_hash)
        if self.content_hash != _digest(self._payload()):
            raise ContractValidationError("content_hash does not match the immutable baseline payload")

    def _payload(self) -> dict[str, object]:
        return {
            "baseline_id": self.baseline_id,
            "version": self.version,
            "source_revision_refs": self.source_revision_refs,
            "check_inventory": tuple(
                {"check_id": check.check_id, "description": check.description}
                for check in self.check_inventory
            ),
            "contract_refs": self.contract_refs,
            "spec_hashes": self.spec_hashes,
            "schema_versions": self.schema_versions,
            "fixture_versions": self.fixture_versions,
            "created_at": self.created_at.isoformat(),
        }

    @classmethod
    def create(
        cls,
        *,
        baseline_id: str,
        version: str,
        source_revision_refs: tuple[str, ...],
        check_inventory: tuple[CheckDefinition, ...],
        contract_refs: tuple[str, ...],
        spec_hashes: tuple[str, ...],
        schema_versions: tuple[str, ...],
        fixture_versions: tuple[str, ...],
        created_at: datetime,
    ) -> "BaselineManifest":
        payload = {
            "baseline_id": baseline_id,
            "version": version,
            "source_revision_refs": source_revision_refs,
            "check_inventory": tuple(
                {"check_id": check.check_id, "description": check.description}
                for check in check_inventory
            ),
            "contract_refs": contract_refs,
            "spec_hashes": spec_hashes,
            "schema_versions": schema_versions,
            "fixture_versions": fixture_versions,
            "created_at": created_at.isoformat(),
        }
        return cls(
            baseline_id=baseline_id,
            version=version,
            source_revision_refs=source_revision_refs,
            check_inventory=check_inventory,
            contract_refs=contract_refs,
            spec_hashes=spec_hashes,
            schema_versions=schema_versions,
            fixture_versions=fixture_versions,
            created_at=created_at,
            content_hash=_digest(payload),
        )

    @property
    def reference(self) -> BaselineRef:
        return BaselineRef(self.baseline_id, self.content_hash, self.version)


@dataclass(frozen=True, slots=True)
class BaselineRegistry:
    """An immutable registry; registering a changed identity is always refused."""

    manifests: tuple[BaselineManifest, ...] = ()

    def __post_init__(self) -> None:
        if not isinstance(self.manifests, tuple) or not all(
            isinstance(manifest, BaselineManifest) for manifest in self.manifests
        ):
            raise ContractValidationError("manifests must contain only BaselineManifest values")
        ids = [manifest.baseline_id for manifest in self.manifests]
        if len(set(ids)) != len(ids):
            raise ContractValidationError("baseline ids must be unique")

    def register(self, manifest: BaselineManifest) -> "BaselineRegistry":
        if not isinstance(manifest, BaselineManifest):
            raise ContractValidationError("manifest must be a BaselineManifest")
        existing = next((item for item in self.manifests if item.baseline_id == manifest.baseline_id), None)
        if existing is not None:
            if existing.content_hash != manifest.content_hash:
                raise ContractValidationError("an immutable baseline cannot be rewritten")
            return self
        return BaselineRegistry(self.manifests + (manifest,))

    def resolve(self, reference: BaselineRef) -> BaselineManifest:
        if not isinstance(reference, BaselineRef):
            raise ContractValidationError("baseline reference must be a BaselineRef")
        manifest = next((item for item in self.manifests if item.baseline_id == reference.reference), None)
        if manifest is None or manifest.reference != reference:
            raise ContractValidationError("baseline reference is not a registered immutable manifest")
        return manifest


@dataclass(frozen=True, slots=True)
class DashboardRerunSpec:
    objective_id: int
    baseline_ref: BaselineRef
    required_chain_head: str
    expected_terminal_states: tuple[ObjectiveState, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.objective_id, int) or isinstance(self.objective_id, bool) or self.objective_id <= 0:
            raise ContractValidationError("objective_id must be a positive integer")
        if not isinstance(self.baseline_ref, BaselineRef):
            raise ContractValidationError("baseline_ref must be a BaselineRef")
        _sha256(self.required_chain_head, "required_chain_head")
        if not isinstance(self.expected_terminal_states, tuple) or not self.expected_terminal_states:
            raise ContractValidationError("expected_terminal_states must not be empty")
        if not all(isinstance(state, ObjectiveState) for state in self.expected_terminal_states):
            raise ContractValidationError("expected_terminal_states must contain ObjectiveState values")


@dataclass(frozen=True, slots=True)
class CompleteLoopDefinition:
    """The nine required controls plus dashboard metadata for one loop."""

    loop_id: str
    objective_id: int
    hypothesis: str
    immutable_baseline_ref: BaselineRef
    bounded_allowed_scope: tuple[str, ...]
    bounded_prohibited_scope: tuple[str, ...]
    exit_criteria: tuple[CheckDefinition, ...]
    positive_control: tuple[CheckDefinition, ...]
    negative_test: tuple[CheckDefinition, ...]
    regression_check: tuple[CheckDefinition, ...]
    rollback_ref: Reference
    dashboard_rerun: DashboardRerunSpec

    def __post_init__(self) -> None:
        _text(self.loop_id, "loop_id")
        if not isinstance(self.objective_id, int) or isinstance(self.objective_id, bool) or self.objective_id <= 0:
            raise ContractValidationError("objective_id must be a positive integer")
        _text(self.hypothesis, "hypothesis")
        if not isinstance(self.immutable_baseline_ref, BaselineRef):
            raise ContractValidationError("immutable_baseline_ref must be a BaselineRef")
        _scope(self.bounded_allowed_scope, "bounded_allowed_scope")
        _scope(self.bounded_prohibited_scope, "bounded_prohibited_scope")
        _checks(self.exit_criteria, "exit_criteria")
        _checks(self.positive_control, "positive_control")
        _checks(self.negative_test, "negative_test")
        _checks(self.regression_check, "regression_check")
        all_ids = [
            check.check_id
            for checks in (self.exit_criteria, self.positive_control, self.negative_test, self.regression_check)
            for check in checks
        ]
        if len(set(all_ids)) != len(all_ids):
            raise ContractValidationError("loop controls must not reuse check ids across control classes")
        _reference(self.rollback_ref, "rollback_ref")
        if not isinstance(self.dashboard_rerun, DashboardRerunSpec):
            raise ContractValidationError("dashboard_rerun must be a DashboardRerunSpec")
        if self.dashboard_rerun.objective_id != self.objective_id:
            raise ContractValidationError("dashboard rerun objective must match the loop objective")
        if self.dashboard_rerun.baseline_ref != self.immutable_baseline_ref:
            raise ContractValidationError("dashboard rerun must use the loop baseline")

    @property
    def check_floor(self) -> tuple[CheckDefinition, ...]:
        """All checks that a successor loop must preserve exactly or strengthen."""
        by_id: dict[str, CheckDefinition] = {}
        for check in self.exit_criteria + self.positive_control + self.negative_test + self.regression_check:
            by_id.setdefault(check.check_id, check)
        return tuple(by_id.values())


@dataclass(frozen=True, slots=True)
class CheckObservation:
    check_id: str
    passed: bool
    evidence_hash: str
    observed_at: datetime
    baseline_ref: BaselineRef
    note: str = ""

    def __post_init__(self) -> None:
        _text(self.check_id, "check_id")
        if not isinstance(self.passed, bool):
            raise ContractValidationError("passed must be a bool")
        _sha256(self.evidence_hash, "evidence_hash")
        _utc(self.observed_at, "observed_at")
        if not isinstance(self.baseline_ref, BaselineRef):
            raise ContractValidationError("baseline_ref must be a BaselineRef")
        if self.note and not isinstance(self.note, str):
            raise ContractValidationError("note must be a string")


@dataclass(frozen=True, slots=True)
class LoopObservations:
    exit_criteria: tuple[CheckObservation, ...]
    positive_control: tuple[CheckObservation, ...]
    negative_test: tuple[CheckObservation, ...]
    regression_check: tuple[CheckObservation, ...]

    def __post_init__(self) -> None:
        for field in ("exit_criteria", "positive_control", "negative_test", "regression_check"):
            values = getattr(self, field)
            if not isinstance(values, tuple) or not values or not all(
                isinstance(value, CheckObservation) for value in values
            ):
                raise ContractValidationError(f"{field} must contain observations")
            if len({value.check_id for value in values}) != len(values):
                raise ContractValidationError(f"{field} must not contain duplicate check ids")


@dataclass(frozen=True, slots=True)
class EvidenceEvent:
    seq: int
    kind: EvidenceEventKind
    loop_id: str
    baseline_ref: BaselineRef
    actor: str
    artifact_hash: str
    recorded_at: datetime
    previous_hash: str
    content_hash: str
    note: str = ""
    disposition: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.seq, int) or isinstance(self.seq, bool) or self.seq <= 0:
            raise ContractValidationError("evidence sequence must be a positive integer")
        if not isinstance(self.kind, EvidenceEventKind):
            raise ContractValidationError("kind must be an EvidenceEventKind")
        _text(self.loop_id, "loop_id")
        if not isinstance(self.baseline_ref, BaselineRef):
            raise ContractValidationError("baseline_ref must be a BaselineRef")
        _text(self.actor, "actor")
        _sha256(self.artifact_hash, "artifact_hash")
        _utc(self.recorded_at, "recorded_at")
        _sha256(self.previous_hash, "previous_hash")
        _sha256(self.content_hash, "content_hash")
        if self.note and not isinstance(self.note, str):
            raise ContractValidationError("note must be a string")
        if self.disposition is not None:
            _text(self.disposition, "disposition")
        if self.content_hash != _digest(self._payload()):
            raise ContractValidationError("content_hash does not match the evidence event")

    def _payload(self) -> dict[str, object]:
        return {
            "seq": self.seq,
            "kind": self.kind.value,
            "loop_id": self.loop_id,
            "baseline_ref": {
                "reference": self.baseline_ref.reference,
                "content_hash": self.baseline_ref.content_hash,
                "version": self.baseline_ref.version,
            },
            "actor": self.actor,
            "artifact_hash": self.artifact_hash,
            "recorded_at": self.recorded_at.isoformat(),
            "previous_hash": self.previous_hash,
            "note": self.note,
            "disposition": self.disposition,
        }

    @classmethod
    def create(
        cls,
        *,
        seq: int,
        kind: EvidenceEventKind,
        loop_id: str,
        baseline_ref: BaselineRef,
        actor: str,
        artifact_hash: str,
        recorded_at: datetime,
        previous_hash: str,
        note: str = "",
        disposition: str | None = None,
    ) -> "EvidenceEvent":
        event = {
            "seq": seq,
            "kind": kind,
            "loop_id": loop_id,
            "baseline_ref": baseline_ref,
            "actor": actor,
            "artifact_hash": artifact_hash,
            "recorded_at": recorded_at,
            "previous_hash": previous_hash,
            "note": note,
            "disposition": disposition,
        }
        provisional = cls(
            **event,
            content_hash=_digest(
                {
                    "seq": seq,
                    "kind": kind.value,
                    "loop_id": loop_id,
                    "baseline_ref": {
                        "reference": baseline_ref.reference,
                        "content_hash": baseline_ref.content_hash,
                        "version": baseline_ref.version,
                    },
                    "actor": actor,
                    "artifact_hash": artifact_hash,
                    "recorded_at": recorded_at.isoformat(),
                    "previous_hash": previous_hash,
                    "note": note,
                    "disposition": disposition,
                }
            ),
        )
        return provisional


@dataclass(frozen=True, slots=True)
class EvidenceChain:
    events: tuple[EvidenceEvent, ...] = ()

    def __post_init__(self) -> None:
        if not isinstance(self.events, tuple) or not all(isinstance(event, EvidenceEvent) for event in self.events):
            raise ContractValidationError("events must contain only EvidenceEvent values")
        previous = _ZERO_HASH
        for expected_seq, event in enumerate(self.events, start=1):
            if event.seq != expected_seq:
                raise ContractValidationError("evidence sequence must be contiguous")
            if event.previous_hash != previous:
                raise ContractValidationError("evidence chain link does not match the previous event")
            if self.events and event is not self.events[0]:
                first = self.events[0]
                if event.loop_id != first.loop_id or event.baseline_ref != first.baseline_ref:
                    raise ContractValidationError("evidence chain cannot mix loops or baselines")
            previous = event.content_hash

    @property
    def head_hash(self) -> str:
        return self.events[-1].content_hash if self.events else _ZERO_HASH

    def append(self, event: EvidenceEvent) -> "EvidenceChain":
        if not isinstance(event, EvidenceEvent):
            raise ContractValidationError("event must be an EvidenceEvent")
        if event.seq != len(self.events) + 1:
            raise ContractValidationError("new evidence event must have the next sequence number")
        if event.previous_hash != self.head_hash:
            raise ContractValidationError("new evidence event must link to the current chain head")
        if self.events and (event.loop_id != self.events[0].loop_id or event.baseline_ref != self.events[0].baseline_ref):
            raise ContractValidationError("new evidence event must use the chain loop and baseline")
        return EvidenceChain(self.events + (event,))


@dataclass(frozen=True, slots=True)
class DashboardRerunReceipt:
    objective_id: int
    baseline_ref: BaselineRef
    evidence_chain_head: str
    receipt_ref: Reference
    state: ObjectiveState
    observed_at: datetime
    matched: bool = True

    def __post_init__(self) -> None:
        if not isinstance(self.objective_id, int) or isinstance(self.objective_id, bool) or self.objective_id <= 0:
            raise ContractValidationError("objective_id must be a positive integer")
        if not isinstance(self.baseline_ref, BaselineRef):
            raise ContractValidationError("baseline_ref must be a BaselineRef")
        _sha256(self.evidence_chain_head, "evidence_chain_head")
        _reference(self.receipt_ref, "receipt_ref")
        if not isinstance(self.state, ObjectiveState):
            raise ContractValidationError("state must be an ObjectiveState")
        _utc(self.observed_at, "observed_at")
        if not isinstance(self.matched, bool):
            raise ContractValidationError("matched must be a bool")


@dataclass(frozen=True, slots=True)
class LoopRecord:
    definition: CompleteLoopDefinition
    state: LoopState
    evidence_chain: EvidenceChain
    opened_at: datetime
    closed_at: datetime | None = None
    blocker: TypedBlocker | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.definition, CompleteLoopDefinition):
            raise ContractValidationError("definition must be a CompleteLoopDefinition")
        if self.state not in {LoopState.BASELINED, LoopState.EXECUTING, LoopState.VERIFYING}:
            raise ContractValidationError("an admitted loop must be open for evaluation")
        if not isinstance(self.evidence_chain, EvidenceChain):
            raise ContractValidationError("evidence_chain must be an EvidenceChain")
        _utc(self.opened_at, "opened_at")
        if self.closed_at is not None:
            raise ContractValidationError("an open loop cannot have closed_at")
        if self.blocker is not None:
            raise ContractValidationError("an open loop cannot have a blocker")


@dataclass(frozen=True, slots=True)
class LoopClosure:
    loop_id: str
    objective_id: int
    state: LoopState
    baseline_ref: BaselineRef
    evidence_chain_head: str
    dashboard_receipt_ref: Reference
    closed_at: datetime
    blocker: TypedBlocker | None = None

    def __post_init__(self) -> None:
        _text(self.loop_id, "loop_id")
        if not isinstance(self.objective_id, int) or isinstance(self.objective_id, bool) or self.objective_id <= 0:
            raise ContractValidationError("objective_id must be a positive integer")
        if self.state not in {
            LoopState.PASSED,
            LoopState.FAILED,
            LoopState.REGRESSED,
            LoopState.BLOCKED_HUMAN,
            LoopState.BLOCKED_DEPENDENCY,
            LoopState.BLOCKED,
            LoopState.ROLLED_BACK,
        }:
            raise ContractValidationError("closure must use a terminal loop state")
        if not isinstance(self.baseline_ref, BaselineRef):
            raise ContractValidationError("baseline_ref must be a BaselineRef")
        _sha256(self.evidence_chain_head, "evidence_chain_head")
        _reference(self.dashboard_receipt_ref, "dashboard_receipt_ref")
        _utc(self.closed_at, "closed_at")
        if self.blocker is not None and not isinstance(self.blocker, TypedBlocker):
            raise ContractValidationError("blocker must be a TypedBlocker")
        blocked = self.state in {LoopState.BLOCKED, LoopState.BLOCKED_HUMAN, LoopState.BLOCKED_DEPENDENCY}
        if blocked != (self.blocker is not None):
            raise ContractValidationError("blocked closures require exactly one typed blocker")
        if self.state is LoopState.PASSED and self.blocker is not None:
            raise ContractValidationError("a passed loop cannot contain a blocker")


def _all_checks(definition: CompleteLoopDefinition) -> tuple[CheckDefinition, ...]:
    return definition.check_floor


def admit_loop(
    definition: CompleteLoopDefinition,
    baselines: BaselineRegistry,
    *,
    opened_at: datetime,
    rollback_refs: Iterable[str] | None = None,
    predecessor: CompleteLoopDefinition | None = None,
) -> LoopRecord:
    """Admit one complete loop without mutating the baseline or a prior loop."""
    if not isinstance(definition, CompleteLoopDefinition):
        raise ContractValidationError("definition must be a CompleteLoopDefinition")
    if not isinstance(baselines, BaselineRegistry):
        raise ContractValidationError("baselines must be a BaselineRegistry")
    _utc(opened_at, "opened_at")
    manifest = baselines.resolve(definition.immutable_baseline_ref)
    if rollback_refs is not None and definition.rollback_ref not in set(rollback_refs):
        raise ContractValidationError("rollback_ref is not resolvable")

    inventory = {check.check_id: check for check in manifest.check_inventory}
    missing = [check.check_id for check in _all_checks(definition) if check.check_id not in inventory]
    if missing:
        raise ContractValidationError(f"baseline check inventory is missing: {', '.join(missing)}")

    if predecessor is not None:
        if not isinstance(predecessor, CompleteLoopDefinition):
            raise ContractValidationError("predecessor must be a CompleteLoopDefinition")
        successor_checks = {check.check_id: check for check in _all_checks(definition)}
        for prior in predecessor.check_floor:
            if successor_checks.get(prior.check_id) != prior:
                raise ContractValidationError("successor loop reduced or rewrote the check floor")

    frozen = EvidenceEvent.create(
        seq=1,
        kind=EvidenceEventKind.BASELINE_FROZEN,
        loop_id=definition.loop_id,
        baseline_ref=definition.immutable_baseline_ref,
        actor="loop-admission",
        artifact_hash=manifest.content_hash,
        recorded_at=opened_at,
        previous_hash=_ZERO_HASH,
        note="immutable baseline admitted for bounded loop",
    )
    chain = EvidenceChain().append(frozen)
    if definition.dashboard_rerun.required_chain_head != chain.head_hash:
        raise ContractValidationError("dashboard rerun required_chain_head must match the frozen baseline event")
    return LoopRecord(definition, LoopState.BASELINED, chain, opened_at)


def _validate_observation_group(
    observations: tuple[CheckObservation, ...],
    expected: tuple[CheckDefinition, ...],
    baseline_ref: BaselineRef,
    field: str,
) -> None:
    expected_ids = tuple(check.check_id for check in expected)
    actual_ids = tuple(observation.check_id for observation in observations)
    if actual_ids != expected_ids:
        raise ContractValidationError(f"{field} observations must match the admitted check order")
    for observation in observations:
        if observation.baseline_ref != baseline_ref:
            raise ContractValidationError(f"{field} observation uses a different baseline")


def _append_observation_events(
    chain: EvidenceChain,
    loop: LoopRecord,
    observations: LoopObservations,
) -> EvidenceChain:
    current = chain
    groups = (
        ("exit", observations.exit_criteria),
        ("positive", observations.positive_control),
        ("negative", observations.negative_test),
        ("regression", observations.regression_check),
    )
    for group_name, values in groups:
        for observation in values:
            event = EvidenceEvent.create(
                seq=len(current.events) + 1,
                kind=EvidenceEventKind.CHECK_OBSERVED,
                loop_id=loop.definition.loop_id,
                baseline_ref=loop.definition.immutable_baseline_ref,
                actor="loop-checker",
                artifact_hash=observation.evidence_hash,
                recorded_at=observation.observed_at,
                previous_hash=current.head_hash,
                note=f"{group_name}:{observation.check_id}={'PASS' if observation.passed else 'FAIL'}",
            )
            current = current.append(event)
    return current


def close_loop(
    loop: LoopRecord,
    observations: LoopObservations,
    dashboard_rerun: DashboardRerunReceipt,
    *,
    closed_at: datetime,
    blocker: TypedBlocker | None = None,
) -> LoopClosure:
    """Append observations, dashboard rerun, and one terminal closure record."""
    if not isinstance(loop, LoopRecord):
        raise ContractValidationError("loop must be a LoopRecord")
    if not isinstance(observations, LoopObservations):
        raise ContractValidationError("observations must be LoopObservations")
    if not isinstance(dashboard_rerun, DashboardRerunReceipt):
        raise ContractValidationError("dashboard_rerun must be a DashboardRerunReceipt")
    _utc(closed_at, "closed_at")
    if closed_at < loop.opened_at:
        raise ContractValidationError("closed_at must not precede opened_at")

    definition = loop.definition
    _validate_observation_group(observations.exit_criteria, definition.exit_criteria, definition.immutable_baseline_ref, "exit_criteria")
    _validate_observation_group(observations.positive_control, definition.positive_control, definition.immutable_baseline_ref, "positive_control")
    _validate_observation_group(observations.negative_test, definition.negative_test, definition.immutable_baseline_ref, "negative_test")
    _validate_observation_group(observations.regression_check, definition.regression_check, definition.immutable_baseline_ref, "regression_check")
    if dashboard_rerun.objective_id != definition.objective_id:
        raise ContractValidationError("dashboard rerun objective does not match the loop")
    if dashboard_rerun.baseline_ref != definition.immutable_baseline_ref:
        raise ContractValidationError("dashboard rerun uses a different baseline")

    checked_chain = _append_observation_events(loop.evidence_chain, loop, observations)
    if dashboard_rerun.evidence_chain_head != checked_chain.head_hash:
        raise ContractValidationError("dashboard rerun must reference the post-check evidence head")

    dashboard_event = EvidenceEvent.create(
        seq=len(checked_chain.events) + 1,
        kind=EvidenceEventKind.DASHBOARD_RERUN,
        loop_id=definition.loop_id,
        baseline_ref=definition.immutable_baseline_ref,
        actor="dashboard-rerun",
        artifact_hash=_digest({"receipt_ref": dashboard_rerun.receipt_ref}),
        recorded_at=dashboard_rerun.observed_at,
        previous_hash=checked_chain.head_hash,
        note=f"objective:{dashboard_rerun.objective_id}:{dashboard_rerun.state.value}",
    )
    current = checked_chain.append(dashboard_event)

    all_checks_pass = all(
        observation.passed
        for group in (
            observations.exit_criteria,
            observations.positive_control,
            observations.negative_test,
            observations.regression_check,
        )
        for observation in group
    )
    regression_failed = any(not observation.passed for observation in observations.regression_check)
    if blocker is not None:
        if not isinstance(blocker, TypedBlocker):
            raise ContractValidationError("blocker must be a TypedBlocker")
        if blocker.kind.value == "HUMAN_GATE":
            state = LoopState.BLOCKED_HUMAN
        elif blocker.kind.value == "DEPENDENCY":
            state = LoopState.BLOCKED_DEPENDENCY
        else:
            state = LoopState.BLOCKED
    elif regression_failed:
        state = LoopState.REGRESSED
    elif not all_checks_pass or not dashboard_rerun.matched:
        state = LoopState.FAILED
    elif dashboard_rerun.state not in definition.dashboard_rerun.expected_terminal_states:
        state = LoopState.FAILED
    else:
        state = LoopState.PASSED

    closure_event = EvidenceEvent.create(
        seq=len(current.events) + 1,
        kind=EvidenceEventKind.LOOP_CLOSED,
        loop_id=definition.loop_id,
        baseline_ref=definition.immutable_baseline_ref,
        actor="loop-closure",
        artifact_hash=current.head_hash,
        recorded_at=closed_at,
        previous_hash=current.head_hash,
        note="terminal closure recorded without baseline rewrite",
        disposition=state.value,
    )
    final_chain = current.append(closure_event)
    return LoopClosure(
        loop_id=definition.loop_id,
        objective_id=definition.objective_id,
        state=state,
        baseline_ref=definition.immutable_baseline_ref,
        evidence_chain_head=final_chain.head_hash,
        dashboard_receipt_ref=dashboard_rerun.receipt_ref,
        closed_at=closed_at,
        blocker=blocker,
    )


__all__ = [
    "BaselineManifest",
    "BaselineRegistry",
    "CheckObservation",
    "CompleteLoopDefinition",
    "DashboardRerunReceipt",
    "DashboardRerunSpec",
    "EvidenceChain",
    "EvidenceEvent",
    "EvidenceEventKind",
    "LoopClosure",
    "LoopObservations",
    "LoopRecord",
    "LoopState",
    "admit_loop",
    "close_loop",
]
