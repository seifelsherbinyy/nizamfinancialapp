"""Focused tests for immutable baselines and complete-loop evidence controls.

Owning contract: UPOI task 1.3; requirements 1.3; design sections 9.2, 10.2,
14.2, and 18. All fixtures are synthetic and local; no live work or secrets.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
import unittest

from upoi_contracts import (
    BaselineManifest,
    BaselineRegistry,
    CheckDefinition,
    CheckObservation,
    CompleteLoopDefinition,
    ContractValidationError,
    DashboardRerunReceipt,
    DashboardRerunSpec,
    EvidenceChain,
    EvidenceEvent,
    EvidenceEventKind,
    LoopObservations,
    LoopRecord,
    LoopState,
    ObjectiveState,
    admit_loop,
    close_loop,
)
from upoi_contracts.models import AuthorityClass, BlockerKind, TypedBlocker
from upoi_contracts.loops import _append_observation_events

UTC = timezone.utc
NOW = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
HASH_A = "a" * 64
HASH_B = "b" * 64
HASH_C = "c" * 64
HASH_D = "d" * 64


def check(name: str) -> CheckDefinition:
    return CheckDefinition(name, f"synthetic {name} control")


def baseline() -> tuple[BaselineManifest, BaselineRegistry]:
    checks = (check("exit"), check("positive"), check("negative"), check("regression"))
    manifest = BaselineManifest.create(
        baseline_id="baseline-synthetic-1",
        version="v1",
        source_revision_refs=("revision:synthetic",),
        check_inventory=checks,
        contract_refs=("contract:upoi-1.3",),
        spec_hashes=(HASH_A,),
        schema_versions=("schema:synthetic-v1",),
        fixture_versions=("fixture:synthetic-v1",),
        created_at=NOW,
    )
    return manifest, BaselineRegistry().register(manifest)


def definition(manifest: BaselineManifest, *, loop_id: str = "UPOI-L01") -> CompleteLoopDefinition:
    frozen = EvidenceEvent.create(
        seq=1,
        kind=EvidenceEventKind.BASELINE_FROZEN,
        loop_id=loop_id,
        baseline_ref=manifest.reference,
        actor="loop-admission",
        artifact_hash=manifest.content_hash,
        recorded_at=NOW,
        previous_hash="0" * 64,
        note="immutable baseline admitted for bounded loop",
    )
    return CompleteLoopDefinition(
        loop_id=loop_id,
        objective_id=1,
        hypothesis="Synthetic bounded control improves evidence quality.",
        immutable_baseline_ref=manifest.reference,
        bounded_allowed_scope=("fixture:synthetic",),
        bounded_prohibited_scope=("live:external-effects",),
        exit_criteria=(check("exit"),),
        positive_control=(check("positive"),),
        negative_test=(check("negative"),),
        regression_check=(check("regression"),),
        rollback_ref="rollback:synthetic-no-mutation",
        dashboard_rerun=DashboardRerunSpec(
            objective_id=1,
            baseline_ref=manifest.reference,
            required_chain_head=frozen.content_hash,
            expected_terminal_states=(ObjectiveState.VERIFIED,),
        ),
    )


def observations(manifest: BaselineManifest, *, regression_passes: bool = True) -> LoopObservations:
    return LoopObservations(
        exit_criteria=(CheckObservation("exit", True, HASH_A, NOW, manifest.reference),),
        positive_control=(CheckObservation("positive", True, HASH_B, NOW, manifest.reference),),
        negative_test=(CheckObservation("negative", True, HASH_C, NOW, manifest.reference),),
        regression_check=(CheckObservation("regression", regression_passes, HASH_D, NOW, manifest.reference),),
    )


class BaselineAndChainTests(unittest.TestCase):
    def test_baseline_is_content_addressed_and_registry_refuses_rewrite(self) -> None:
        manifest, registry = baseline()
        self.assertEqual(manifest.reference.content_hash, manifest.content_hash)
        self.assertIs(registry.register(manifest), registry)
        with self.assertRaises(ContractValidationError):
            replace(manifest, content_hash=HASH_B)

        changed = BaselineManifest.create(
            baseline_id=manifest.baseline_id,
            version="v2",
            source_revision_refs=manifest.source_revision_refs,
            check_inventory=manifest.check_inventory,
            contract_refs=manifest.contract_refs,
            spec_hashes=manifest.spec_hashes,
            schema_versions=manifest.schema_versions,
            fixture_versions=manifest.fixture_versions,
            created_at=manifest.created_at,
        )
        with self.assertRaises(ContractValidationError):
            registry.register(changed)

    def test_chain_is_append_only_and_rejects_tampered_links(self) -> None:
        manifest, _ = baseline()
        first = EvidenceEvent.create(
            seq=1,
            kind=EvidenceEventKind.BASELINE_FROZEN,
            loop_id="UPOI-L01",
            baseline_ref=manifest.reference,
            actor="synthetic",
            artifact_hash=manifest.content_hash,
            recorded_at=NOW,
            previous_hash="0" * 64,
        )
        chain = EvidenceChain().append(first)
        second = EvidenceEvent.create(
            seq=2,
            kind=EvidenceEventKind.CHECK_OBSERVED,
            loop_id="UPOI-L01",
            baseline_ref=manifest.reference,
            actor="synthetic",
            artifact_hash=HASH_A,
            recorded_at=NOW,
            previous_hash=chain.head_hash,
        )
        extended = chain.append(second)
        self.assertEqual(len(chain.events), 1)
        self.assertEqual(extended.events[1].previous_hash, chain.head_hash)
        with self.assertRaises(ContractValidationError):
            chain.append(replace(second, previous_hash=HASH_B))
        with self.assertRaises(ContractValidationError):
            EvidenceChain((replace(second, seq=1, previous_hash=first.content_hash),))


class AdmissionTests(unittest.TestCase):
    def test_complete_loop_requires_resolvable_rollback_and_frozen_head(self) -> None:
        manifest, registry = baseline()
        loop = definition(manifest)
        admitted = admit_loop(
            loop,
            registry,
            opened_at=NOW,
            rollback_refs=(loop.rollback_ref,),
        )
        self.assertEqual(admitted.state, LoopState.BASELINED)
        self.assertEqual(admitted.evidence_chain.events[0].kind, EvidenceEventKind.BASELINE_FROZEN)
        with self.assertRaises(ContractValidationError):
            admit_loop(loop, registry, opened_at=NOW, rollback_refs=())

    def test_successor_cannot_reduce_or_rewrite_the_check_floor(self) -> None:
        manifest, registry = baseline()
        original = definition(manifest)
        reduced = replace(
            original,
            loop_id="UPOI-L01-successor",
            positive_control=(check("positive"),),
            negative_test=(check("negative"),),
            regression_check=(check("different-regression"),),
            dashboard_rerun=replace(original.dashboard_rerun),
        )
        with self.assertRaises(ContractValidationError):
            admit_loop(
                reduced,
                registry,
                opened_at=NOW,
                rollback_refs=(reduced.rollback_ref,),
                predecessor=original,
            )

    def test_missing_complete_loop_control_fails_closed(self) -> None:
        manifest, _ = baseline()
        with self.assertRaises(ContractValidationError):
            replace(definition(manifest), negative_test=())


class ClosureTests(unittest.TestCase):
    def _admitted(self) -> tuple[BaselineManifest, CompleteLoopDefinition, LoopRecord]:
        manifest, registry = baseline()
        loop = definition(manifest)
        admitted = admit_loop(loop, registry, opened_at=NOW, rollback_refs=(loop.rollback_ref,))
        return manifest, loop, admitted

    def _rerun(self, admitted: LoopRecord, manifest: BaselineManifest, loop: CompleteLoopDefinition, obs: LoopObservations, *, state: ObjectiveState = ObjectiveState.VERIFIED, matched: bool = True) -> DashboardRerunReceipt:
        checked = _append_observation_events(admitted.evidence_chain, admitted, obs)
        return DashboardRerunReceipt(
            objective_id=loop.objective_id,
            baseline_ref=manifest.reference,
            evidence_chain_head=checked.head_hash,
            receipt_ref="dashboard-rerun:synthetic",
            state=state,
            observed_at=NOW,
            matched=matched,
        )

    def test_all_controls_and_dashboard_rerun_close_passed_without_rewriting_baseline(self) -> None:
        manifest, loop, admitted = self._admitted()
        obs = observations(manifest)
        rerun = self._rerun(admitted, manifest, loop, obs)
        closure = close_loop(admitted, obs, rerun, closed_at=NOW)
        self.assertEqual(closure.state, LoopState.PASSED)
        self.assertEqual(closure.baseline_ref, manifest.reference)
        self.assertNotEqual(closure.evidence_chain_head, admitted.evidence_chain.head_hash)

    def test_failed_and_regressed_checks_remain_non_passed(self) -> None:
        manifest, loop, admitted = self._admitted()
        failed = observations(manifest, regression_passes=False)
        failed_rerun = self._rerun(admitted, manifest, loop, failed)
        closure = close_loop(admitted, failed, failed_rerun, closed_at=NOW)
        self.assertEqual(closure.state, LoopState.REGRESSED)
        self.assertNotEqual(closure.state, LoopState.PASSED)

        manifest2, loop2, admitted2 = self._admitted()
        failed_exit = replace(observations(manifest2), exit_criteria=(CheckObservation("exit", False, HASH_A, NOW, manifest2.reference),))
        closure2 = close_loop(admitted2, failed_exit, self._rerun(admitted2, manifest2, loop2, failed_exit), closed_at=NOW)
        self.assertEqual(closure2.state, LoopState.FAILED)

    def test_human_blocker_closes_as_blocked_human_not_passed(self) -> None:
        manifest, loop, admitted = self._admitted()
        obs = observations(manifest)
        blocker = TypedBlocker(
            BlockerKind.HUMAN_GATE,
            "OWNER_APPROVAL_REQUIRED",
            "Synthetic external effect is gated.",
            "Owner records the named approval.",
            AuthorityClass.GOVERNANCE,
            NOW,
        )
        closure = close_loop(
            admitted,
            obs,
            self._rerun(admitted, manifest, loop, obs),
            closed_at=NOW,
            blocker=blocker,
        )
        self.assertEqual(closure.state, LoopState.BLOCKED_HUMAN)
        self.assertIs(closure.blocker, blocker)

    def test_dashboard_failure_is_failed_even_when_checks_pass(self) -> None:
        manifest, loop, admitted = self._admitted()
        obs = observations(manifest)
        closure = close_loop(
            admitted,
            obs,
            self._rerun(admitted, manifest, loop, obs, matched=False),
            closed_at=NOW,
        )
        self.assertEqual(closure.state, LoopState.FAILED)

    def test_terminal_state_cannot_be_represented_as_an_open_loop(self) -> None:
        manifest, loop, admitted = self._admitted()
        with self.assertRaises(ContractValidationError):
            replace(admitted, state=LoopState.PASSED)


if __name__ == "__main__":
    unittest.main()
