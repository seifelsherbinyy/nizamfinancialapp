"""Validated complete-loop adapter for the canonical UPOI objective registry.

Owning contract: UPOI task 7.2; requirements 1.3, 1.4, 2.1, 2.2, 3.4;
design sections 10.1, 10.2, and 18. Phase: UPOI task 7.2.

This module is an immutable, offline control-plane adapter. It does not create a
second objective registry, write domain state, calculate money, call providers,
access secrets, or perform migration cutover. PFOS/MAL remains the existing
financial authority and migration alias.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from .loops import (
    BaselineManifest,
    BaselineRegistry,
    CompleteLoopDefinition,
    DashboardRerunSpec,
    LoopRecord,
    admit_loop,
)
from .models import (
    AuthorityClass,
    BaselineRef,
    BlockerKind,
    CheckDefinition,
    ContractValidationError,
    ObjectiveEvaluation,
    ObjectiveState,
    TypedBlocker,
    _reference,
    _text,
    _utc,
)
from .objective_dashboard import (
    ObjectiveDashboardProjection,
    ObjectiveRegistryEntry,
    UPOI_OBJECTIVES,
    project_objective_dashboard,
    validate_objective_registry,
)


PFOS_MAL_ALIAS = "PFOS/MAL"
MAL_PFOS_MIGRATION_ALIAS = "MAL/PFOS"
FINANCIAL_OBJECTIVE_ID = 10


class ReadOnlyPfosPort(Protocol):
    """The narrow PFOS read surface used by the financial evidence adapter."""

    def read_financial_snapshot(self, query: object) -> object:
        """Return a deterministic PFOS snapshot or raise its typed refusal."""


@dataclass(frozen=True, slots=True)
class PfosEvidenceBinding:
    """A read-only mapping from UPOI-L10 to existing PFOS/MAL evidence."""

    objective_id: int
    query_ref: str
    source_alias: str = PFOS_MAL_ALIAS
    migration_alias: str = MAL_PFOS_MIGRATION_ALIAS
    read_only: bool = True
    authority: AuthorityClass = AuthorityClass.DETERMINISTIC_DOMAIN

    def __post_init__(self) -> None:
        if self.objective_id != FINANCIAL_OBJECTIVE_ID:
            raise ContractValidationError("PFOS evidence binding is reserved for UPOI-L10")
        _reference(self.query_ref, "query_ref")
        if self.source_alias != PFOS_MAL_ALIAS:
            raise ContractValidationError("financial evidence must preserve the PFOS/MAL alias")
        if self.migration_alias != MAL_PFOS_MIGRATION_ALIAS:
            raise ContractValidationError("financial evidence must preserve the MAL/PFOS migration alias")
        if not self.read_only:
            raise ContractValidationError("PFOS objective evidence must be read-only")
        if self.authority is not AuthorityClass.DETERMINISTIC_DOMAIN:
            raise ContractValidationError("PFOS evidence must retain deterministic-domain authority")


@dataclass(frozen=True, slots=True)
class PfosEvidenceReceipt:
    """Non-monetary provenance for a deterministic PFOS snapshot read."""

    binding: PfosEvidenceBinding
    snapshot_ref: str
    source_ref: str
    source_version: str
    content_hash: str
    observed_at: str

    def __post_init__(self) -> None:
        if not isinstance(self.binding, PfosEvidenceBinding):
            raise ContractValidationError("binding must be PfosEvidenceBinding")
        _reference(self.snapshot_ref, "snapshot_ref")
        _reference(self.source_ref, "source_ref")
        _text(self.source_version, "source_version")
        _text(self.observed_at, "observed_at")
        _text(self.content_hash, "content_hash")
        if self.binding.objective_id != FINANCIAL_OBJECTIVE_ID:
            raise ContractValidationError("PFOS receipt must map to UPOI-L10")


@dataclass(frozen=True, slots=True)
class CompleteLoopEntry:
    """One canonical objective plus its complete-loop definition and blocker plan."""

    objective: ObjectiveRegistryEntry
    definition: CompleteLoopDefinition
    blocker_template: TypedBlocker
    financial_evidence: PfosEvidenceBinding | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.objective, ObjectiveRegistryEntry):
            raise ContractValidationError("objective must be an ObjectiveRegistryEntry")
        if not isinstance(self.definition, CompleteLoopDefinition):
            raise ContractValidationError("definition must be a CompleteLoopDefinition")
        if self.definition.objective_id != self.objective.id:
            raise ContractValidationError("loop objective must match the canonical registry")
        if not isinstance(self.blocker_template, TypedBlocker):
            raise ContractValidationError("every loop requires a typed blocker template")
        if self.financial_evidence is not None:
            if self.objective.id != FINANCIAL_OBJECTIVE_ID:
                raise ContractValidationError("only UPOI-L10 may bind financial evidence")
            if self.financial_evidence.objective_id != self.objective.id:
                raise ContractValidationError("financial evidence objective does not match the loop")


@dataclass(frozen=True, slots=True)
class CompleteLoopAdapter:
    """Immutable adapter from one validated registry to twenty complete loops."""

    baseline: BaselineManifest
    registry: tuple[ObjectiveRegistryEntry, ...]
    entries: tuple[CompleteLoopEntry, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.baseline, BaselineManifest):
            raise ContractValidationError("baseline must be a BaselineManifest")
        validated = validate_objective_registry(self.registry)
        if tuple(validated) != self.registry:
            raise ContractValidationError("adapter registry must be the validated canonical registry")
        if len(self.entries) != 20:
            raise ContractValidationError("adapter must contain exactly twenty loops")
        if tuple(entry.objective.id for entry in self.entries) != tuple(range(1, 21)):
            raise ContractValidationError("adapter loops must preserve objective order")
        inventory = {check.check_id: check for check in self.baseline.check_inventory}
        for entry in self.entries:
            if entry.definition.immutable_baseline_ref != self.baseline.reference:
                raise ContractValidationError("every loop must use the immutable adapter baseline")
            missing = [check.check_id for check in entry.definition.check_floor if check.check_id not in inventory]
            if missing:
                raise ContractValidationError(f"baseline check inventory is missing: {', '.join(missing)}")

    @property
    def baseline_ref(self) -> BaselineRef:
        return self.baseline.reference

    @property
    def definitions(self) -> tuple[CompleteLoopDefinition, ...]:
        return tuple(entry.definition for entry in self.entries)

    @property
    def rollback_refs(self) -> tuple[str, ...]:
        return tuple(entry.definition.rollback_ref for entry in self.entries)

    def entry(self, objective_id: int) -> CompleteLoopEntry:
        if not isinstance(objective_id, int) or isinstance(objective_id, bool) or not 1 <= objective_id <= 20:
            raise ContractValidationError("objective_id must be an integer from 1 through 20")
        return self.entries[objective_id - 1]

    def admit_all(self, *, opened_at: datetime) -> tuple[LoopRecord, ...]:
        """Admit all loops against the same immutable baseline without mutating it."""

        _utc(opened_at, "opened_at")
        registry = BaselineRegistry().register(self.baseline)
        return tuple(
            admit_loop(
                definition,
                registry,
                opened_at=opened_at,
                rollback_refs=self.rollback_refs,
            )
            for definition in self.definitions
        )

    def project_dashboard(
        self,
        evaluations: Sequence[ObjectiveEvaluation],
    ) -> ObjectiveDashboardProjection:
        """Rerun the existing dashboard from this adapter's one validated registry."""

        return project_objective_dashboard(evaluations, self.baseline_ref, registry=self.registry)

    def read_financial_evidence(
        self,
        port: ReadOnlyPfosPort,
        *,
        filters: Mapping[str, object] | None = None,
    ) -> PfosEvidenceReceipt:
        """Read PFOS evidence for UPOI-L10 without exposing or calculating money."""

        binding = self.entry(FINANCIAL_OBJECTIVE_ID).financial_evidence
        if binding is None:
            raise ContractValidationError("UPOI-L10 must have a PFOS evidence binding")
        if not hasattr(port, "read_financial_snapshot"):
            raise ContractValidationError("PFOS port must expose read_financial_snapshot")
        from src.server.pfos_port import FinanceQuery

        query = FinanceQuery(query_ref=binding.query_ref, filters=dict(filters or {}))
        snapshot = port.read_financial_snapshot(query)
        if not all(hasattr(snapshot, field) for field in ("version_ref", "provenance", "observed_at")):
            raise ContractValidationError("PFOS read did not return a financial snapshot")
        provenance = snapshot.provenance
        for field in ("source_ref", "source_version", "content_hash", "observed_at"):
            if not hasattr(provenance, field):
                raise ContractValidationError("PFOS snapshot provenance is incomplete")
        _reference(snapshot.version_ref, "snapshot.version_ref")
        _reference(provenance.source_ref, "snapshot.provenance.source_ref")
        _text(provenance.source_version, "snapshot.provenance.source_version")
        _text(provenance.content_hash, "snapshot.provenance.content_hash")
        _text(snapshot.observed_at, "snapshot.observed_at")
        return PfosEvidenceReceipt(
            binding=binding,
            snapshot_ref=snapshot.version_ref,
            source_ref=provenance.source_ref,
            source_version=provenance.source_version,
            content_hash=provenance.content_hash,
            observed_at=snapshot.observed_at,
        )


def create_complete_loop_baseline(
    *,
    baseline_id: str,
    version: str,
    source_revision_refs: tuple[str, ...],
    contract_refs: tuple[str, ...],
    spec_hashes: tuple[str, ...],
    schema_versions: tuple[str, ...],
    fixture_versions: tuple[str, ...],
    created_at: datetime,
    registry: Sequence[ObjectiveRegistryEntry] = UPOI_OBJECTIVES,
) -> BaselineManifest:
    """Create one content-addressed baseline inventory for all twenty loops."""

    validated = validate_objective_registry(registry)
    checks = tuple(
        CheckDefinition(f"UPOI-L{objective.id:02d}:{kind}", f"{objective.slug} {kind} control")
        for objective in validated
        for kind in ("exit", "positive", "negative", "regression")
    )
    return BaselineManifest.create(
        baseline_id=baseline_id,
        version=version,
        source_revision_refs=source_revision_refs,
        check_inventory=checks,
        contract_refs=contract_refs,
        spec_hashes=spec_hashes,
        schema_versions=schema_versions,
        fixture_versions=fixture_versions,
        created_at=created_at,
    )


def _loop_checks(objective: ObjectiveRegistryEntry) -> tuple[CheckDefinition, ...]:
    prefix = f"UPOI-L{objective.id:02d}"
    return tuple(
        CheckDefinition(f"{prefix}:{kind}", f"{objective.slug} {kind} control")
        for kind in ("exit", "positive", "negative", "regression")
    )


def _blocker_template(objective: ObjectiveRegistryEntry, created_at: datetime) -> TypedBlocker:
    return TypedBlocker(
        kind=BlockerKind.DEPENDENCY,
        code=f"UPOI-L{objective.id:02d}:EVIDENCE_UNAVAILABLE",
        summary="Required bounded evidence or verification is unavailable.",
        next_owner_action=(
            f"Provide fresh synthetic evidence for UPOI-L{objective.id:02d} and rerun its dashboard receipt."
        ),
        authority_class=AuthorityClass.GOVERNANCE,
        raised_at=created_at,
    )


def _entry(
    objective: ObjectiveRegistryEntry,
    baseline: BaselineManifest,
) -> CompleteLoopEntry:
    checks = _loop_checks(objective)
    exit_check, positive_check, negative_check, regression_check = checks
    frozen_head = _baseline_event_hash(objective, baseline)
    definition = CompleteLoopDefinition(
        loop_id=f"UPOI-L{objective.id:02d}",
        objective_id=objective.id,
        hypothesis=(
            f"A bounded, evidence-backed control can validate: {objective.validation_question}"
        ),
        immutable_baseline_ref=baseline.reference,
        bounded_allowed_scope=(
            f"synthetic:objective/UPOI-L{objective.id:02d}",
            "read-model:objective-dashboard",
            "evidence:local-only",
        ),
        bounded_prohibited_scope=(
            "effect:external",
            "provider:live",
            "state:canonical-domain-write",
            "authority:new",
        ),
        exit_criteria=(exit_check,),
        positive_control=(positive_check,),
        negative_test=(negative_check,),
        regression_check=(regression_check,),
        rollback_ref=f"rollback:UPOI-L{objective.id:02d}",
        dashboard_rerun=DashboardRerunSpec(
            objective_id=objective.id,
            baseline_ref=baseline.reference,
            required_chain_head=frozen_head,
            expected_terminal_states=(ObjectiveState.VERIFIED,),
        ),
    )
    financial = (
        PfosEvidenceBinding(
            objective_id=objective.id,
            query_ref="pfos:read-only/UPOI-L10",
        )
        if objective.id == FINANCIAL_OBJECTIVE_ID
        else None
    )
    return CompleteLoopEntry(
        objective=objective,
        definition=definition,
        blocker_template=_blocker_template(objective, baseline.created_at),
        financial_evidence=financial,
    )


def _baseline_event_hash(objective: ObjectiveRegistryEntry, baseline: BaselineManifest) -> str:
    """Derive the admission event hash exactly as the loop primitive does."""

    from .loops import EvidenceEvent, EvidenceEventKind

    event = EvidenceEvent.create(
        seq=1,
        kind=EvidenceEventKind.BASELINE_FROZEN,
        loop_id=f"UPOI-L{objective.id:02d}",
        baseline_ref=baseline.reference,
        actor="loop-admission",
        artifact_hash=baseline.content_hash,
        recorded_at=baseline.created_at,
        previous_hash="0" * 64,
        note="immutable baseline admitted for bounded loop",
    )
    return event.content_hash


def build_complete_loop_adapter(
    baseline: BaselineManifest,
    *,
    registry: Sequence[ObjectiveRegistryEntry] = UPOI_OBJECTIVES,
) -> CompleteLoopAdapter:
    """Build twenty complete loops from the existing validated dashboard registry."""

    validated = validate_objective_registry(registry)
    entries = tuple(_entry(objective, baseline) for objective in validated)
    return CompleteLoopAdapter(baseline=baseline, registry=validated, entries=entries)


__all__ = [
    "CompleteLoopAdapter",
    "CompleteLoopEntry",
    "FINANCIAL_OBJECTIVE_ID",
    "MAL_PFOS_MIGRATION_ALIAS",
    "PFOS_MAL_ALIAS",
    "PfosEvidenceBinding",
    "PfosEvidenceReceipt",
    "ReadOnlyPfosPort",
    "build_complete_loop_adapter",
    "create_complete_loop_baseline",
]
