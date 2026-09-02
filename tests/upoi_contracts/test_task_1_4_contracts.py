"""Task 1.4 unit and contract tests for UPOI governance and loop invariants.

Owning contract: UPOI task 1.4; requirements 1.1, 1.3, 1.4; design sections 7.1,
9.2, 10, 10.1, 10.2, 14.2, and 18.

All values are synthetic and local. These tests do not call providers, access
secrets, mutate stores, perform live work, or alter acceptance floors.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import re
import unittest

from upoi_contracts import (
    AuthorityClass,
    BaselineManifest,
    BaselineRegistry,
    BlockerKind,
    CheckDefinition,
    CheckObservation,
    CompleteLoopDefinition,
    ContractValidationError,
    DashboardRerunReceipt,
    DashboardRerunSpec,
    EvidenceChain,
    EvidenceEvent,
    EvidenceEventKind,
    EvidenceLabel,
    Grant,
    LoopObservations,
    LoopState,
    ObjectiveState,
    PrivacyClass,
    ConfidenceBand,
    ProvenanceRecord,
    TypedBlocker,
    admit_loop,
    close_loop,
)
from upoi_contracts.loops import _append_observation_events

UTC = timezone.utc
NOW = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
HASH_A = "a" * 64
HASH_B = "b" * 64
HASH_C = "c" * 64
HASH_D = "d" * 64


CANONICAL_OBJECTIVES = (
    (1, "build-persistent-personal-operating-intelligence", "Does NIZAM operate continuously autonomously?"),
    (2, "maintain-continuous-agent-memory", "Does NIZAM remember relevant history?"),
    (3, "transform-thoughts-into-intelligence", "Are thoughts becoming useful intelligence?"),
    (4, "turn-goals-into-execution", "Are goals becoming completed actions?"),
    (5, "prioritize-recovery-under-constraints", "Does NIZAM protect depleted capacity?"),
    (6, "improve-decision-quality", "Are my decisions becoming better?"),
    (7, "challenge-assumptions-before-action", "Are weak assumptions challenged early?"),
    (8, "convert-problems-into-plans", "Do problems produce executable plans?"),
    (9, "track-decisions-and-learning", "Does NIZAM learn from outcomes?"),
    (10, "operate-mal-pfos-financial-intelligence", "Is MAL improving financial outcomes?"),
    (11, "optimize-health-and-energy", "Is NIZAM improving daily capacity?"),
    (12, "detect-behavioral-and-psyche-patterns", "Does NIZAM understand my patterns?"),
    (13, "reduce-impulsive-decisions", "Are harmful impulses increasingly interrupted?"),
    (14, "maintain-faith-and-values-alignment", "Are actions aligned with values?"),
    (15, "increase-professional-leverage", "Is professional leverage measurably increasing?"),
    (16, "automate-life-administration", "Is manual administration consistently decreasing?"),
    (17, "coordinate-specialized-agent-personas", "Do agents collaborate without confusion?"),
    (18, "anticipate-risks-and-opportunities", "Does NIZAM act before problems?"),
    (19, "continuously-improve-agent-intelligence", "Is NIZAM improving through usage?"),
    (20, "compound-personal-autonomy", "Am I becoming more autonomous?"),
)


def _normalized_words(question: str) -> tuple[str, ...]:
    return tuple(word for word in re.sub(r"[^\w\s]", "", question).split() if word)


def _assert_objective_registry_contract(registry: tuple[tuple[int, str, str], ...]) -> None:
    if len(registry) != 20:
        raise AssertionError("registry must contain exactly twenty objectives")
    ids = tuple(item[0] for item in registry)
    slugs = tuple(item[1] for item in registry)
    if ids != tuple(range(1, 21)):
        raise AssertionError("objective ids must be ordered 1 through 20")
    if len(set(ids)) != 20 or len(set(slugs)) != 20:
        raise AssertionError("objective ids and slugs must be unique")
    for objective_id, _, question in registry:
        if question != CANONICAL_OBJECTIVES[objective_id - 1][2]:
            raise AssertionError("objective question was changed")
        if len(_normalized_words(question)) != 5:
            raise AssertionError("objective question must normalize to five words")


def _check(name: str) -> CheckDefinition:
    return CheckDefinition(name, f"synthetic {name} control")


def _provenance() -> ProvenanceRecord:
    return ProvenanceRecord(
        source_ref="synthetic/source",
        source_version="v1",
        content_hash=HASH_A,
        observed_at=NOW,
        evidence_label=EvidenceLabel.FACT,
        authority_class=AuthorityClass.EVIDENCE_ONLY,
        privacy_class=PrivacyClass.PRIVATE,
        confidence=ConfidenceBand.HIGH,
    )


def _baseline() -> tuple[BaselineManifest, BaselineRegistry]:
    manifest = BaselineManifest.create(
        baseline_id="baseline-task-1-4",
        version="v1",
        source_revision_refs=("revision:synthetic",),
        check_inventory=(_check("exit"), _check("positive"), _check("negative"), _check("regression")),
        contract_refs=("contract:upoi-1.4",),
        spec_hashes=(HASH_A,),
        schema_versions=("schema:synthetic-v1",),
        fixture_versions=("fixture:synthetic-v1",),
        created_at=NOW,
    )
    return manifest, BaselineRegistry().register(manifest)


def _definition(manifest: BaselineManifest) -> CompleteLoopDefinition:
    frozen = EvidenceEvent.create(
        seq=1,
        kind=EvidenceEventKind.BASELINE_FROZEN,
        loop_id="UPOI-L01",
        baseline_ref=manifest.reference,
        actor="loop-admission",
        artifact_hash=manifest.content_hash,
        recorded_at=NOW,
        previous_hash="0" * 64,
        note="immutable baseline admitted for bounded loop",
    )
    return CompleteLoopDefinition(
        loop_id="UPOI-L01",
        objective_id=1,
        hypothesis="Synthetic bounded control improves evidence quality.",
        immutable_baseline_ref=manifest.reference,
        bounded_allowed_scope=("fixture:synthetic",),
        bounded_prohibited_scope=("live:external-effects",),
        exit_criteria=(_check("exit"),),
        positive_control=(_check("positive"),),
        negative_test=(_check("negative"),),
        regression_check=(_check("regression"),),
        rollback_ref="rollback:synthetic",
        dashboard_rerun=DashboardRerunSpec(
            objective_id=1,
            baseline_ref=manifest.reference,
            required_chain_head=frozen.content_hash,
            expected_terminal_states=(ObjectiveState.VERIFIED,),
        ),
    )


def _observations(manifest: BaselineManifest, regression_passes: bool = True) -> LoopObservations:
    return LoopObservations(
        exit_criteria=(CheckObservation("exit", True, HASH_A, NOW, manifest.reference),),
        positive_control=(CheckObservation("positive", True, HASH_B, NOW, manifest.reference),),
        negative_test=(CheckObservation("negative", True, HASH_C, NOW, manifest.reference),),
        regression_check=(CheckObservation("regression", regression_passes, HASH_D, NOW, manifest.reference),),
    )


def _rerun(admitted, manifest, loop, observations, *, state=ObjectiveState.VERIFIED, matched=True):
    current = _append_observation_events(admitted.evidence_chain, admitted, observations)
    return DashboardRerunReceipt(1, manifest.reference, current.head_hash, "rerun:synthetic", state, NOW, matched)


class AuthorityAndProvenanceContractTests(unittest.TestCase):
    def test_authority_classes_are_distinct_and_unsupported_transfers_fail_closed(self) -> None:
        self.assertEqual(len(tuple(AuthorityClass)), 8)
        self.assertEqual(len({item.value for item in AuthorityClass}), 8)
        for issuer, recipient in (
            (AuthorityClass.OWNER, AuthorityClass.EXECUTION_RUNTIME),
            (AuthorityClass.CONTEXT, AuthorityClass.EXECUTION_RUNTIME),
            (AuthorityClass.EXECUTION_RUNTIME, AuthorityClass.DETERMINISTIC_DOMAIN),
        ):
            with self.subTest(issuer=issuer, recipient=recipient), self.assertRaises(ContractValidationError):
                Grant(
                    grant_id="grant:invalid",
                    issuer=issuer,
                    recipient=recipient,
                    scope=("synthetic/action",),
                    issued_at=NOW,
                    expires_at=datetime(2026, 1, 2, 4, 4, 5, tzinfo=UTC),
                    provenance=_provenance(),
                    idempotency_key="idem:synthetic",
                )

    def test_provenance_rejects_malformed_records_and_non_utc_observations(self) -> None:
        values = {
            "source_ref": "synthetic/source",
            "source_version": "v1",
            "content_hash": HASH_A,
            "observed_at": NOW,
            "evidence_label": EvidenceLabel.FACT,
            "authority_class": AuthorityClass.EVIDENCE_ONLY,
            "privacy_class": PrivacyClass.PRIVATE,
            "confidence": ConfidenceBand.HIGH,
        }
        invalid = (
            {"source_ref": ""},
            {"source_version": ""},
            {"content_hash": "A" * 64},
            {"content_hash": "not-a-hash"},
            {"observed_at": datetime(2026, 1, 2, 3, 4, 5)},
            {"observed_at": NOW.astimezone(timezone(timedelta(hours=1)))},
            {"evidence_label": "FACT"},
            {"authority_class": "context"},
            {"privacy_class": "private"},
            {"confidence": "high"},
        )
        for override in invalid:
            candidate = {**values, **override}
            with self.subTest(override=override), self.assertRaises(ContractValidationError):
                ProvenanceRecord(**candidate)


class ObjectiveRegistryContractTests(unittest.TestCase):
    def test_canonical_registry_has_twenty_ordered_unique_five_word_questions(self) -> None:
        _assert_objective_registry_contract(CANONICAL_OBJECTIVES)

    def test_duplicate_reordered_and_reworded_registry_entries_fail_closed(self) -> None:
        cases = (
            CANONICAL_OBJECTIVES[:-1] + (CANONICAL_OBJECTIVES[0],),
            (CANONICAL_OBJECTIVES[1], CANONICAL_OBJECTIVES[0], *CANONICAL_OBJECTIVES[2:]),
            CANONICAL_OBJECTIVES[:-1] + ((20, "compound-personal-autonomy", "Am I becoming autonomous?"),),
        )
        for candidate in cases:
            with self.subTest(candidate=candidate[-1]), self.assertRaises(AssertionError):
                _assert_objective_registry_contract(candidate)


class BaselineAndLoopContractTests(unittest.TestCase):
    def test_baseline_identity_is_immutable_and_missing_rollback_is_refused(self) -> None:
        manifest, registry = _baseline()
        self.assertEqual(manifest.reference.content_hash, manifest.content_hash)
        with self.assertRaises(ContractValidationError):
            registry.register(BaselineManifest.create(
                baseline_id=manifest.baseline_id,
                version="v2",
                source_revision_refs=manifest.source_revision_refs,
                check_inventory=manifest.check_inventory,
                contract_refs=manifest.contract_refs,
                spec_hashes=manifest.spec_hashes,
                schema_versions=manifest.schema_versions,
                fixture_versions=manifest.fixture_versions,
                created_at=manifest.created_at,
            ))
        with self.assertRaises(ContractValidationError):
            admit_loop(_definition(manifest), registry, opened_at=NOW, rollback_refs=())

    def test_tampered_evidence_link_is_rejected_without_rewriting_original_chain(self) -> None:
        manifest, _ = _baseline()
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
            artifact_hash=HASH_B,
            recorded_at=NOW,
            previous_hash=chain.head_hash,
        )
        extended = chain.append(second)
        self.assertEqual(len(chain.events), 1)
        self.assertEqual(len(extended.events), 2)
        with self.assertRaises(ContractValidationError):
            chain.append(replace(second, previous_hash=HASH_C))

    def test_loop_states_preserve_pass_fail_regressed_and_blocked_human_outcomes(self) -> None:
        manifest, registry = _baseline()
        loop = _definition(manifest)
        admitted = admit_loop(loop, registry, opened_at=NOW, rollback_refs=(loop.rollback_ref,))
        self.assertEqual(admitted.state, LoopState.BASELINED)

        passed_observations = _observations(manifest)
        passed = close_loop(admitted, passed_observations, _rerun(admitted, manifest, loop, passed_observations), closed_at=NOW)
        self.assertEqual(passed.state, LoopState.PASSED)

        manifest2, registry2 = _baseline()
        loop2 = _definition(manifest2)
        admitted2 = admit_loop(loop2, registry2, opened_at=NOW, rollback_refs=(loop2.rollback_ref,))
        failed_observations = _observations(manifest2, regression_passes=False)
        regressed = close_loop(admitted2, failed_observations, _rerun(admitted2, manifest2, loop2, failed_observations), closed_at=NOW)
        self.assertEqual(regressed.state, LoopState.REGRESSED)
        self.assertNotEqual(regressed.state, LoopState.PASSED)

        manifest3, registry3 = _baseline()
        loop3 = _definition(manifest3)
        admitted3 = admit_loop(loop3, registry3, opened_at=NOW, rollback_refs=(loop3.rollback_ref,))
        blocker = TypedBlocker(
            BlockerKind.HUMAN_GATE,
            "OWNER_APPROVAL_REQUIRED",
            "Synthetic effect remains human gated.",
            "Owner records approval for the named scope.",
            AuthorityClass.GOVERNANCE,
            NOW,
        )
        blocked = close_loop(
            admitted3,
            _observations(manifest3),
            _rerun(admitted3, manifest3, loop3, _observations(manifest3)),
            closed_at=NOW,
            blocker=blocker,
        )
        self.assertEqual(blocked.state, LoopState.BLOCKED_HUMAN)
        self.assertIs(blocked.blocker, blocker)


if __name__ == "__main__":
    unittest.main()
