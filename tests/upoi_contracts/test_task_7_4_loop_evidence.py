"""Property 5 checks for complete-loop evidence integrity.

Owning contract: UPOI task 7.4; requirements 1.2, 1.3, 1.4;
design sections 9.2, 10.2, 14.2, 18, and 24.2. Phase: offline
synthetic verification. No providers, network, secrets, deployment,
persistence, commits, or pushes are used.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from typing import NamedTuple
import unittest

from hypothesis import given, settings, strategies as st
from hypothesis.strategies import composite

from upoi_contracts import (
    AuthorityClass,
    BaselineManifest,
    BaselineRegistry,
    BlockerKind,
    CheckDefinition,
    CheckObservation,
    ContractValidationError,
    DashboardRerunReceipt,
    LoopObservations,
    LoopState,
    ObjectiveState,
    TypedBlocker,
    admit_loop,
    build_complete_loop_adapter,
    close_loop,
    create_complete_loop_baseline,
)
from upoi_contracts.loops import _append_observation_events

UTC = timezone.utc
NOW = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
HASH_A = "a" * 64
HASH_B = "b" * 64
HASH_C = "c" * 64
HASH_D = "d" * 64


class LoopCase(NamedTuple):
    kind: str
    nonce: int
    invalid_head: str
    rerun_state: ObjectiveState


@composite
def loop_cases(draw) -> LoopCase:
    return LoopCase(
        kind=draw(
            st.sampled_from(
                (
                    "complete",
                    "tampered-baseline",
                    "omitted-check",
                    "lowered-floor",
                    "invalid-chain-head",
                    "different-baseline",
                    "failed-rerun",
                    "human-gate",
                )
            )
        ),
        nonce=draw(st.integers(min_value=0, max_value=100_000)),
        invalid_head=draw(st.sampled_from(("0" * 64, "e" * 64, "f" * 64))),
        rerun_state=draw(st.sampled_from((ObjectiveState.FAILED, ObjectiveState.AT_RISK))),
    )


def _baseline(*, baseline_id: str = "baseline:task-7-4", version: str = "synthetic-v1") -> BaselineManifest:
    return create_complete_loop_baseline(
        baseline_id=baseline_id,
        version=version,
        source_revision_refs=("revision:synthetic-task-7-4",),
        contract_refs=("contract:upoi-task-7-4",),
        spec_hashes=(HASH_A,),
        schema_versions=("schema:loop-v1",),
        fixture_versions=("fixture:loop-v1",),
        created_at=NOW,
    )


def _admitted() -> tuple[BaselineManifest, object, object]:
    baseline = _baseline()
    adapter = build_complete_loop_adapter(baseline)
    entry = adapter.entry(1)
    registry = BaselineRegistry().register(baseline)
    record = admit_loop(
        entry.definition,
        registry,
        opened_at=NOW,
        rollback_refs=adapter.rollback_refs,
    )
    return baseline, entry.definition, record


def _observations(
    baseline: BaselineManifest,
    definition: object,
    *,
    failed_group: str | None = None,
    omitted_group: str | None = None,
    alternate_baseline: BaselineManifest | None = None,
) -> LoopObservations:
    groups = {
        "exit_criteria": (HASH_A, definition.exit_criteria),
        "positive_control": (HASH_B, definition.positive_control),
        "negative_test": (HASH_C, definition.negative_test),
        "regression_check": (HASH_D, definition.regression_check),
    }
    observations: dict[str, tuple[CheckObservation, ...]] = {}
    for group_name, (evidence_hash, checks) in groups.items():
        values = tuple(
            CheckObservation(
                check_id=(
                    f"omitted:{check.check_id}"
                    if omitted_group == group_name and index == 0
                    else check.check_id
                ),
                passed=failed_group != group_name,
                evidence_hash=evidence_hash,
                observed_at=NOW,
                baseline_ref=(alternate_baseline or baseline).reference,
            )
            for index, check in enumerate(checks)
        )
        observations[group_name] = values
    return LoopObservations(**observations)


def _rerun(
    record: object,
    baseline: BaselineManifest,
    definition: object,
    observations: LoopObservations,
    *,
    state: ObjectiveState = ObjectiveState.VERIFIED,
    matched: bool = True,
    baseline_ref=None,
    evidence_chain_head: str | None = None,
) -> DashboardRerunReceipt:
    checked = _append_observation_events(record.evidence_chain, record, observations)
    return DashboardRerunReceipt(
        objective_id=definition.objective_id,
        baseline_ref=baseline.reference if baseline_ref is None else baseline_ref,
        evidence_chain_head=checked.head_hash if evidence_chain_head is None else evidence_chain_head,
        receipt_ref="dashboard-rerun:synthetic-task-7-4",
        state=state,
        observed_at=NOW,
        matched=matched,
    )


def _human_gate_blocker() -> TypedBlocker:
    return TypedBlocker(
        kind=BlockerKind.HUMAN_GATE,
        code="OWNER_APPROVAL_REQUIRED",
        summary="Synthetic external effect is gated.",
        next_owner_action="Owner records the named synthetic approval.",
        authority_class=AuthorityClass.GOVERNANCE,
        raised_at=NOW,
    )


class LoopEvidenceIntegrityPropertyTests(unittest.TestCase):
    # **Validates: Requirements 1.2, 1.3, 1.4**
    @settings(max_examples=80, deadline=None)
    @given(loop_cases())
    def test_property_loop_evidence_integrity(self, case: LoopCase) -> None:
        """Only complete same-baseline evidence can pass a loop."""
        baseline, definition, record = _admitted()
        registry = BaselineRegistry().register(baseline)

        if case.kind == "tampered-baseline":
            tampered = _baseline(version=f"tampered-{case.nonce}")
            with self.assertRaises(ContractValidationError):
                registry.register(tampered)
            tampered_definition = replace(
                definition,
                immutable_baseline_ref=tampered.reference,
                dashboard_rerun=replace(
                    definition.dashboard_rerun,
                    baseline_ref=tampered.reference,
                ),
            )
            with self.assertRaises(ContractValidationError):
                admit_loop(
                    tampered_definition,
                    registry,
                    opened_at=NOW,
                    rollback_refs=(tampered_definition.rollback_ref,),
                )
            return

        if case.kind == "lowered-floor":
            original_check = definition.positive_control[0]
            lowered = replace(
                definition,
                positive_control=(
                    CheckDefinition(original_check.check_id, "weakened synthetic control"),
                ),
            )
            with self.assertRaises(ContractValidationError):
                admit_loop(
                    lowered,
                    registry,
                    opened_at=NOW,
                    rollback_refs=(lowered.rollback_ref,),
                    predecessor=definition,
                )
            return

        observations = _observations(
            baseline,
            definition,
            omitted_group="positive_control" if case.kind == "omitted-check" else None,
            alternate_baseline=(
                _baseline(baseline_id=f"baseline:other:{case.nonce}", version="synthetic-other")
                if case.kind == "different-baseline"
                else None
            ),
        )

        if case.kind == "omitted-check":
            with self.assertRaises(ContractValidationError):
                close_loop(
                    record,
                    observations,
                    _rerun(record, baseline, definition, observations),
                    closed_at=NOW,
                )
            return

        if case.kind == "different-baseline":
            with self.assertRaises(ContractValidationError):
                close_loop(
                    record,
                    observations,
                    _rerun(record, baseline, definition, observations),
                    closed_at=NOW,
                )
            return

        if case.kind == "invalid-chain-head":
            with self.assertRaises(ContractValidationError):
                close_loop(
                    record,
                    observations,
                    _rerun(
                        record,
                        baseline,
                        definition,
                        observations,
                        evidence_chain_head=case.invalid_head,
                    ),
                    closed_at=NOW,
                )
            return

        if case.kind == "failed-rerun":
            failed_observations = _observations(
                baseline,
                definition,
                failed_group="regression" if case.rerun_state is ObjectiveState.FAILED else None,
            )
            closure = close_loop(
                record,
                failed_observations,
                _rerun(
                    record,
                    baseline,
                    definition,
                    failed_observations,
                    state=case.rerun_state,
                    matched=case.rerun_state is ObjectiveState.FAILED,
                ),
                closed_at=NOW,
            )
            self.assertNotEqual(closure.state, LoopState.PASSED)
            self.assertIn(closure.state, (LoopState.FAILED, LoopState.REGRESSED))
            return

        if case.kind == "human-gate":
            closure = close_loop(
                record,
                observations,
                _rerun(record, baseline, definition, observations),
                closed_at=NOW,
                blocker=_human_gate_blocker(),
            )
            self.assertEqual(closure.state, LoopState.BLOCKED_HUMAN)
            self.assertNotEqual(closure.state, LoopState.PASSED)
            return

        checked = _append_observation_events(record.evidence_chain, record, observations)
        self.assertTrue(all(event.baseline_ref == baseline.reference for event in checked.events))
        closure = close_loop(
            record,
            observations,
            _rerun(record, baseline, definition, observations),
            closed_at=NOW,
        )
        self.assertEqual(closure.state, LoopState.PASSED)
        self.assertEqual(closure.baseline_ref, baseline.reference)


if __name__ == "__main__":
    unittest.main()
