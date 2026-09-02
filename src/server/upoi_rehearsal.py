"""Synthetic end-to-end UPOI task 8.1 rehearsal composition.

Owning contract: UPOI task 8.1; requirements 1.1-1.4, 2.1-2.4, and 3.1-3.4.
Phase: offline synthetic rehearsal only. This module composes tasks 1-7 through
in-memory injected providers and redacted references; it performs no network,
provider, persistence, deployment, secret, live Drive/Telegram, or canonical write.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Mapping

from src.server.drive_archive import (
    ArchiveApproval,
    ArchiveArtifact,
    DriveArchivePort,
    DRIVE_FILE_SCOPE,
    ReadBackReceipt,
    StagedArtifact,
    UploadReceipt,
)
from src.server.pfos_migration import (
    LegacyMalRecord,
    PfosCandidate,
    SyntheticMigrationApproval,
    stage_synthetic_mal_migration,
)
from src.server.pfos_port import (
    DeterministicFinancePort,
    FinanceQuery,
    FinanceSourceUnavailableError,
    FinancialSnapshot,
    ProvenanceRecord as PfosProvenanceRecord,
)
from src.server.rollback_rehearsal import (
    FailedCandidate,
    KnownGoodReference,
    ReclaimableWork,
    RestoreReceipt,
    SyntheticEncryptedSnapshot,
    VerificationReport,
    rehearse_rollback_restore,
)
from upoi_contracts import (
    AuthorityClass,
    BaselineRegistry,
    CheckObservation,
    ConfidenceBand,
    DashboardRerunReceipt,
    EvidenceLabel,
    ExecutionOutcome,
    Grant,
    LoopObservations,
    LoopState,
    ObjectiveEvaluation,
    ObjectiveState,
    OperatorTurn,
    ProfilePolicy,
    PrivacyClass,
    ProvenanceRecord,
    authorize_plan,
    build_complete_loop_adapter,
    close_loop,
    create_complete_loop_baseline,
    admit_loop,
    plan_operator_turn,
)
from upoi_contracts.dispatch import BoundedDispatcher, DispatchEffect
from upoi_contracts.loops import _append_observation_events
from upoi_contracts.models import Reference

UTC = timezone.utc
REHEARSAL_TIME = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
_HASHES = ("a" * 64, "b" * 64, "c" * 64, "d" * 64)


class RehearsalInvariantError(RuntimeError):
    """Raised when an integrated synthetic rehearsal cannot prove its invariants."""


@dataclass(frozen=True, slots=True)
class QueueReplayReceipt:
    """Synthetic queue evidence showing duplicate delivery and safe effect replay."""

    first_enqueue_committed: bool
    duplicate_enqueue_no_op: bool
    dispatcher_replayed: bool
    canonical_effect_count: int
    target_mutation_count: int


@dataclass(frozen=True, slots=True)
class PfosUnavailableOutcome:
    """Typed unavailable-source outcome with no substitute monetary result."""

    refused: bool
    code: str
    estimate: None = None


@dataclass(frozen=True, slots=True)
class ProvenanceRefusalOutcome:
    """Typed context refusal proving restricted data never reaches a provider."""

    refused: bool
    code: str
    provider_bound_count: int


@dataclass(frozen=True, slots=True)
class RehearsalResult:
    """All redacted evidence produced by one task 8.1 rehearsal run."""

    baseline_hash_before: str
    baseline_hash_after: str
    read_only_values: tuple[tuple[str, int], ...]
    read_only_version_ref: str
    read_only_source_ref: str
    blocked_effect_count: int
    blocked_target_mutation_count: int
    approved_effect_outcome: ExecutionOutcome
    approved_target_mutation_count: int
    queue_replay: QueueReplayReceipt
    pfos_unavailable: PfosUnavailableOutcome
    provenance_refusal: ProvenanceRefusalOutcome
    archive_scope: str
    archive_read_back_verified: bool
    archive_receipt_ref: str
    migration_status: str
    migration_staged_only: bool
    migration_source_unchanged: bool
    rollback_status: str
    rollback_reclaimed_keys: tuple[str, ...]
    rollback_failed_candidates: tuple[str, ...]
    loop_state: LoopState
    loop_checks_executed: tuple[str, ...]
    loop_evidence_event_count: int
    dashboard_card_count: int
    dashboard_baseline_ref: Reference
    pfos_evidence_source_version: str


class _SyntheticPfosSource:
    """Injected deterministic PFOS source; the fixture does not calculate values."""

    def __init__(self, *, available: bool = True) -> None:
        self.available = available
        self.read_count = 0
        self.snapshot = FinancialSnapshot(
            version_ref="synthetic:pfos/snapshot-v1",
            observed_at="2026-01-02T03:04:05Z",
            values={"balance_milliunits": 123400, "one_egp_milliunits": 1000},
            provenance=PfosProvenanceRecord(
                source_ref="synthetic:pfos/source-v1",
                source_version="synthetic-pfos-v1",
                observed_at="2026-01-02T03:04:05Z",
                content_hash="e" * 64,
            ),
        )

    def read_financial_snapshot(self, query: FinanceQuery) -> FinancialSnapshot:
        if not self.available:
            raise FinanceSourceUnavailableError("read_financial_snapshot")
        self.read_count += 1
        return self.snapshot

    def evaluate_decision(self, request: object) -> object:
        raise FinanceSourceUnavailableError("evaluate_decision")


@dataclass(frozen=True, slots=True)
class _SyntheticContextItem:
    source_ref: str
    source_version: str
    content_hash: str
    privacy_class: str
    complete: bool


class _SyntheticProvenanceBoundary:
    """Minimal injected context boundary used only to prove fail-closed egress."""

    def __init__(self) -> None:
        self.provider_bound_count = 0

    def bind_provider_context(self, item: _SyntheticContextItem) -> ProvenanceRefusalOutcome:
        if not item.complete:
            return ProvenanceRefusalOutcome(True, "INCOMPLETE_PROVENANCE", self.provider_bound_count)
        if item.privacy_class == "restricted" or item.privacy_class.startswith("restricted_"):
            return ProvenanceRefusalOutcome(True, "RESTRICTED_CONTEXT_EGRESS", self.provider_bound_count)
        self.provider_bound_count += 1
        return ProvenanceRefusalOutcome(False, "BOUND", self.provider_bound_count)


class _SyntheticEffectTarget:
    """In-memory reversible target used by bounded dispatch and replay."""

    def __init__(self) -> None:
        self.mutation_count = 0
        self.state = "ready"

    def execute(self, plan: object) -> DispatchEffect:
        self.mutation_count += 1
        self.state = "applied"
        return DispatchEffect(("synthetic:effect/reversible-1",), {"state": "applied"})

    def observe(self, plan: object, receipt: object) -> object:
        return {"state": self.state}


class _SyntheticArchiveProvider:
    """In-memory Drive provider with exact drive.file scope and read-back rows."""

    def __init__(self) -> None:
        self.uploads: list[dict[str, object]] = []
        self.rows: dict[str, ReadBackReceipt] = {}
        self.sequence = 0

    @property
    def scopes(self) -> frozenset[str]:
        return frozenset({DRIVE_FILE_SCOPE})

    def upload(self, **kwargs: object) -> UploadReceipt:
        self.uploads.append(dict(kwargs))
        self.sequence += 1
        receipt = UploadReceipt(
            f"synthetic:archive/upload-{self.sequence}",
            str(kwargs["idempotency_key"]),
            f"synthetic:destination/v{self.sequence}",
        )
        self.rows[receipt.remote_ref] = ReadBackReceipt(
            receipt.remote_ref,
            receipt.destination_version,
            str(kwargs["artifact_version"]),
            str(kwargs["content_hash"]),
        )
        return receipt

    def read_back(self, remote_ref: str) -> ReadBackReceipt:
        return self.rows[remote_ref]


class _SyntheticEncryptor:
    def encrypt(self, staged: StagedArtifact, public_key_ref: str) -> bytes:
        return b"synthetic:ciphertext:" + staged.payload


class _SyntheticRollbackControls:
    def __init__(self, work: tuple[ReclaimableWork, ...]) -> None:
        self.work = work
        self.evidence: list[object] = []
        self.events: list[str] = []

    def halt(self) -> None:
        self.events.append("halt")

    def fence(self) -> None:
        self.events.append("fence")

    def inspect(self) -> Mapping[str, int]:
        self.events.append("inspect")
        return {"queued": 1, "running": len(self.work), "done": 0, "failed": 1}

    def capture(self, evidence: object) -> None:
        self.events.append("evidence")
        self.evidence.append(evidence)

    def restore(
        self,
        snapshot: SyntheticEncryptedSnapshot,
        known_good: KnownGoodReference,
        failed_candidates: tuple[FailedCandidate, ...],
    ) -> RestoreReceipt:
        self.events.append("restore")
        return RestoreReceipt(known_good.snapshot_ref, known_good.snapshot_version, known_good.binary_ref, True, True)

    def reclaim(self, work: tuple[ReclaimableWork, ...]) -> tuple[ReclaimableWork, ...]:
        self.events.append("reclaim")
        return work

    def run(self, known_good: KnownGoodReference) -> VerificationReport:
        self.events.append("verify")
        return VerificationReport(True, True, True, True, True)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RehearsalInvariantError(message)


def _grant_for(plan_key: str, *, profile_id: str) -> Grant:
    return Grant(
        grant_id="synthetic:grant/runtime-1",
        issuer=AuthorityClass.GOVERNANCE,
        recipient=AuthorityClass.EXECUTION_RUNTIME,
        scope=("runtime/synthetic-effect", "runtime:invoke"),
        issued_at=REHEARSAL_TIME - timedelta(minutes=1),
        expires_at=REHEARSAL_TIME + timedelta(minutes=5),
        provenance=ProvenanceRecord(
            source_ref="synthetic:governance/grant",
            source_version="synthetic-governance-v1",
            content_hash="f" * 64,
            observed_at=REHEARSAL_TIME,
            evidence_label=EvidenceLabel.FACT,
            authority_class=AuthorityClass.GOVERNANCE,
            privacy_class=PrivacyClass.PRIVATE,
            confidence=ConfidenceBand.HIGH,
        ),
        idempotency_key=plan_key,
        profile_id=profile_id,
    )


def _complete_loop_evidence(adapter: object, baseline: object) -> tuple[LoopState, str, int]:
    """Close UPOI-L10 through the existing adapter and loop evidence primitives."""

    entry = adapter.entry(10)
    registry = BaselineRegistry().register(baseline)
    admitted = admit_loop(
        entry.definition,
        registry,
        opened_at=REHEARSAL_TIME,
        rollback_refs=adapter.rollback_refs,
    )
    observations = LoopObservations(
        exit_criteria=(CheckObservation("UPOI-L10:exit", True, _HASHES[0], REHEARSAL_TIME, baseline.reference),),
        positive_control=(CheckObservation("UPOI-L10:positive", True, _HASHES[1], REHEARSAL_TIME, baseline.reference),),
        negative_test=(CheckObservation("UPOI-L10:negative", True, _HASHES[2], REHEARSAL_TIME, baseline.reference),),
        regression_check=(CheckObservation("UPOI-L10:regression", True, _HASHES[3], REHEARSAL_TIME, baseline.reference),),
    )
    checked_chain = _append_observation_events(admitted.evidence_chain, admitted, observations)
    rerun = DashboardRerunReceipt(
        objective_id=10,
        baseline_ref=baseline.reference,
        evidence_chain_head=checked_chain.head_hash,
        receipt_ref="synthetic:dashboard/rerun-l10",
        state=ObjectiveState.VERIFIED,
        observed_at=REHEARSAL_TIME,
    )
    closure = close_loop(admitted, observations, rerun, closed_at=REHEARSAL_TIME)
    _require(closure.state is LoopState.PASSED, "complete loop did not pass")
    # One frozen event, four checks, dashboard rerun, and terminal closure.
    return closure.state, closure.evidence_chain_head, len(checked_chain.events) + 2


def run_synthetic_end_to_end_rehearsal() -> RehearsalResult:
    """Run all task 8.1 scenarios against one immutable synthetic baseline.

    The returned evidence is intentionally compact and redacted. Any broken
    invariant raises before a result is returned, so callers cannot mistake a
    partial rehearsal for a passing one.
    """

    # The complete-loop adapter is the composition root for the existing task 1-7
    # objective, baseline, dashboard, and PFOS evidence surfaces.
    baseline = create_complete_loop_baseline(
        baseline_id="synthetic:baseline/upoi-task-8-1",
        version="synthetic-upoi-v1",
        source_revision_refs=("synthetic:revision/tasks-1-7",),
        contract_refs=("contract:upoi-task-8-1", "contract:upoi-composition"),
        spec_hashes=("1" * 64,),
        schema_versions=("synthetic:schema/upoi-v1",),
        fixture_versions=("synthetic:fixture/task-8-1-v1",),
        created_at=REHEARSAL_TIME,
    )
    baseline_hash_before = baseline.content_hash
    adapter = build_complete_loop_adapter(baseline)
    _require(len(adapter.entries) == 20, "canonical twenty-loop adapter was not composed")

    # Read-only question: PFOS supplies exact integer milliunits and provenance.
    pfos_source = _SyntheticPfosSource()
    pfos = DeterministicFinancePort(pfos_source)
    read_plan_decision = plan_operator_turn(
        OperatorTurn(
            turn_ref="synthetic:turn/read-financial",
            intent="read_financial_snapshot",
            requested_action="read",
            target_authority=AuthorityClass.DETERMINISTIC_DOMAIN,
            scope=("finance/read/synthetic",),
            idempotency_key="synthetic:idempotency/read-financial",
        )
    )
    _require(read_plan_decision.plan is not None, "read-only financial plan was not accepted")
    read_admission = authorize_plan(
        read_plan_decision.plan,
        ProfilePolicy("synthetic-pfos", AuthorityClass.DETERMINISTIC_DOMAIN, ("finance/read/",)),
        (),
        (),
        REHEARSAL_TIME,
    )
    _require(read_admission.authorized_plan is not None, "read-only financial plan was blocked")
    snapshot = pfos.read_financial_snapshot(FinanceQuery("synthetic:query/balance", {}))
    pfos_evidence = adapter.read_financial_evidence(pfos, filters={"scope": "synthetic"})
    _require(snapshot.values["one_egp_milliunits"] == 1000, "one EGP milliunit boundary drifted")
    _require(snapshot.values["balance_milliunits"] == 123400, "PFOS value was altered")
    _require(pfos_source.read_count == 2, "financial evidence did not use the injected PFOS read")

    # Missing grant: authorization blocks before the target can mutate.
    blocked_target = _SyntheticEffectTarget()
    blocked_turn = OperatorTurn(
        turn_ref="synthetic:turn/blocked-effect",
        intent="invoke_bounded_runtime",
        requested_action="invoke",
        target_authority=AuthorityClass.EXECUTION_RUNTIME,
        scope=("runtime/synthetic-effect",),
        idempotency_key="synthetic:idempotency/blocked-effect",
    )
    blocked_plan_decision = plan_operator_turn(blocked_turn)
    _require(blocked_plan_decision.plan is not None, "blocked effect plan was not constructed")
    blocked_admission = authorize_plan(
        blocked_plan_decision.plan,
        ProfilePolicy("synthetic-runtime", AuthorityClass.EXECUTION_RUNTIME, ("runtime/", "runtime:")),
        (),
        (),
        REHEARSAL_TIME,
    )
    _require(blocked_admission.authorized_plan is None, "missing grant unexpectedly admitted an effect")
    _require(blocked_admission.external_effect_count == 0 and blocked_target.mutation_count == 0, "blocked effect mutated target")

    # Explicitly granted reversible effect: dispatch once, then replay by key.
    effect_target = _SyntheticEffectTarget()
    effect_key = "synthetic:idempotency/reversible-effect"
    approved_turn = OperatorTurn(
        turn_ref="synthetic:turn/reversible-effect",
        intent="invoke_bounded_runtime",
        requested_action="invoke",
        target_authority=AuthorityClass.EXECUTION_RUNTIME,
        scope=("runtime/synthetic-effect",),
        idempotency_key=effect_key,
    )
    approved_plan_decision = plan_operator_turn(approved_turn)
    _require(approved_plan_decision.plan is not None, "approved effect plan was not constructed")
    approved_plan = approved_plan_decision.plan
    grant = _grant_for(effect_key, profile_id="synthetic-runtime")
    approved_admission = authorize_plan(
        approved_plan,
        ProfilePolicy("synthetic-runtime", AuthorityClass.EXECUTION_RUNTIME, ("runtime/", "runtime:")),
        (grant,),
        (),
        REHEARSAL_TIME,
    )
    _require(approved_admission.authorized_plan is not None, "explicit reversible grant was not admitted")
    dispatcher = BoundedDispatcher(effect_target, clock=lambda: REHEARSAL_TIME)
    approved_result = dispatcher.dispatch(approved_admission.authorized_plan)
    replay_result = dispatcher.dispatch(approved_admission.authorized_plan)
    _require(approved_result.verification is not None and approved_result.verification.matched, "approved effect was not verified")
    _require(approved_result.execution.outcome is ExecutionOutcome.SUCCEEDED, "approved effect did not succeed")
    _require(replay_result.replayed and effect_target.mutation_count == 1, "safe replay duplicated the effect")

    # Queue duplicate delivery is a no-op and preserves the same idempotency key.
    queued_keys: set[str] = set()
    first_enqueue = effect_key not in queued_keys
    if first_enqueue:
        queued_keys.add(effect_key)
    second_enqueue_committed = effect_key not in queued_keys
    duplicate_enqueue = not second_enqueue_committed
    queue_replay = QueueReplayReceipt(
        first_enqueue_committed=first_enqueue,
        duplicate_enqueue_no_op=duplicate_enqueue,
        dispatcher_replayed=replay_result.replayed,
        canonical_effect_count=len(dispatcher.records),
        target_mutation_count=effect_target.mutation_count,
    )
    _require(queue_replay.first_enqueue_committed and queue_replay.duplicate_enqueue_no_op, "queue replay was not deduplicated")

    # PFOS unavailable: typed refusal and no estimate or substitute value.
    unavailable = DeterministicFinancePort(_SyntheticPfosSource(available=False))
    try:
        unavailable.read_financial_snapshot(FinanceQuery("synthetic:query/unavailable", {}))
    except FinanceSourceUnavailableError as error:
        pfos_unavailable = PfosUnavailableOutcome(True, error.code)
    else:
        raise RehearsalInvariantError("PFOS unavailable source returned a financial result")

    # Incomplete and restricted provenance both stop before provider binding.
    provenance_boundary = _SyntheticProvenanceBoundary()
    incomplete = provenance_boundary.bind_provider_context(
        _SyntheticContextItem("synthetic:context/incomplete", "v1", "2" * 64, "private", False)
    )
    restricted = provenance_boundary.bind_provider_context(
        _SyntheticContextItem("synthetic:context/restricted", "v1", "3" * 64, "restricted_local_context", True)
    )
    _require(incomplete.refused and restricted.refused and provenance_boundary.provider_bound_count == 0, "restricted provenance reached provider context")
    provenance_refusal = ProvenanceRefusalOutcome(
        True,
        f"{incomplete.code}+{restricted.code}",
        provenance_boundary.provider_bound_count,
    )

    # Drive archive: injected drive.file provider, encrypted redacted artifact, read-back proof.
    archive_provider = _SyntheticArchiveProvider()
    archive = DriveArchivePort(archive_provider, encryptor=_SyntheticEncryptor())
    archive_receipt = archive.mirror(
        ArchiveArtifact(
            "synthetic:artifact/rehearsal",
            "rehearsal-v1",
            b'{"rehearsal":"redacted"}',
            "private",
            True,
            {},
        ),
        approval=ArchiveApproval(DRIVE_FILE_SCOPE, frozenset({"private"})),
        idempotency_key="synthetic:idempotency/archive-rehearsal",
        public_key_ref="synthetic:public-key-ref",
    )
    archive_read_back = archive.read_back(
        UploadReceipt(archive_receipt.remote_ref, archive_receipt.idempotency_key, archive_receipt.destination_version)
    )
    _require(archive_receipt.encrypted and archive_read_back.content_hash == archive_receipt.content_hash, "Drive read-back was not verified")

    # Staging-only MAL/PFOS parity through the existing migration mapper.
    legacy_record = LegacyMalRecord(
        "synthetic:mal/rehearsal-1",
        "transaction",
        "1.000",
        "EGP_MAJOR_DECIMAL_TEXT",
        "EGP",
        "synthetic-mal-v1",
    )
    expected_candidate = PfosCandidate(
        "synthetic:pfos-candidate/rehearsal-1",
        legacy_record.record_ref,
        legacy_record.kind,
        1000,
        legacy_record.currency,
        legacy_record.source_version,
    )
    legacy_before = (legacy_record,)
    staged_candidates, migration_receipt = stage_synthetic_mal_migration(
        legacy_before,
        (expected_candidate,),
        approval=SyntheticMigrationApproval(),
    )
    _require(staged_candidates == (expected_candidate,) and migration_receipt.deterministic_output_parity, "migration staging parity failed")
    _require(migration_receipt.staged_only and migration_receipt.legacy_source_unchanged, "migration was not staging-only")

    # Halt/fence, restore the known-good encrypted snapshot, reclaim original keys, verify.
    snapshot_artifact = ArchiveArtifact(
        "synthetic:artifact/known-good",
        "snapshot-v1",
        b'{"snapshot":"redacted"}',
        "private",
        True,
        {},
    )
    snapshot_staged = archive.stage(snapshot_artifact)
    snapshot_encrypted = archive.encrypt(snapshot_staged, "synthetic:public-key-ref")
    snapshot_upload = archive.upload(snapshot_encrypted, idempotency_key="synthetic:idempotency/archive-snapshot")
    synthetic_snapshot = SyntheticEncryptedSnapshot(
        "synthetic:snapshot/known-good",
        "snapshot-v1",
        "synthetic:binary/v1",
        snapshot_encrypted,
        snapshot_upload,
    )
    reclaimable = (ReclaimableWork("synthetic:queue/reclaim-1", "synthetic:idempotency/reclaim-1"),)
    rollback_controls = _SyntheticRollbackControls(reclaimable)
    rollback_receipt = rehearse_rollback_restore(
        archive=archive,
        snapshot=synthetic_snapshot,
        known_good=KnownGoodReference(
            synthetic_snapshot.snapshot_ref,
            synthetic_snapshot.snapshot_version,
            synthetic_snapshot.binary_ref,
        ),
        intake=rollback_controls,
        workers=rollback_controls,
        queue=rollback_controls,
        evidence=rollback_controls,
        restorer=rollback_controls,
        verifier=rollback_controls,
        failed_candidates=(FailedCandidate("synthetic:pfos-candidate/failed-1", "SYNTHETIC_FAILURE"),),
        reclaimable_work=reclaimable,
        correlation_refs=("synthetic:correlation/rollback-1",),
    )
    _require(rollback_receipt.status == "VERIFIED" and not rollback_receipt.resumption_authorized, "rollback verification did not remain fail-closed")
    _require(rollback_controls.events[:4] == ["halt", "fence", "inspect", "evidence"], "rollback did not halt and fence first")

    loop_state, loop_evidence_head, loop_event_count = _complete_loop_evidence(adapter, baseline)
    dashboard = adapter.project_dashboard(
        (
            ObjectiveEvaluation(
                objective_id=10,
                state=ObjectiveState.VERIFIED,
                baseline_ref=baseline.reference,
                evidence_refs=("synthetic:evidence/UPOI-L10", loop_evidence_head),
                findings=(),
                evaluated_at=REHEARSAL_TIME,
            ),
        )
    )
    _require(len(dashboard.cards) == 20 and dashboard.baseline_ref == baseline.reference, "dashboard rerun was not canonical")
    baseline_hash_after = baseline.content_hash
    _require(baseline_hash_before == baseline_hash_after, "loop evidence rewrote the immutable baseline")

    return RehearsalResult(
        baseline_hash_before=baseline_hash_before,
        baseline_hash_after=baseline_hash_after,
        read_only_values=tuple(snapshot.values.items()),
        read_only_version_ref=snapshot.version_ref,
        read_only_source_ref=snapshot.provenance.source_ref,
        blocked_effect_count=blocked_admission.external_effect_count,
        blocked_target_mutation_count=blocked_target.mutation_count,
        approved_effect_outcome=approved_result.execution.outcome,
        approved_target_mutation_count=effect_target.mutation_count,
        queue_replay=queue_replay,
        pfos_unavailable=pfos_unavailable,
        provenance_refusal=provenance_refusal,
        archive_scope=DRIVE_FILE_SCOPE,
        archive_read_back_verified=archive_read_back.content_hash == archive_receipt.content_hash,
        archive_receipt_ref=archive_receipt.remote_ref,
        migration_status=migration_receipt.status,
        migration_staged_only=migration_receipt.staged_only,
        migration_source_unchanged=legacy_before == (legacy_record,),
        rollback_status=rollback_receipt.status,
        rollback_reclaimed_keys=rollback_receipt.reclaimed_idempotency_keys,
        rollback_failed_candidates=rollback_receipt.failed_candidate_refs,
        loop_state=loop_state,
        loop_checks_executed=("exit", "positive", "negative", "regression"),
        loop_evidence_event_count=loop_event_count,
        dashboard_card_count=len(dashboard.cards),
        dashboard_baseline_ref=dashboard.baseline_ref.reference,
        pfos_evidence_source_version=pfos_evidence.source_version,
    )


__all__ = [
    "PfosUnavailableOutcome",
    "ProvenanceRefusalOutcome",
    "QueueReplayReceipt",
    "RehearsalInvariantError",
    "RehearsalResult",
    "run_synthetic_end_to_end_rehearsal",
]
