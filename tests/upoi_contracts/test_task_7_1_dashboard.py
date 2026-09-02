"""Task 7.1 tests for the immutable objective dashboard read model.

Owning contract: UPOI task 7.1; requirements 1.3, 1.4, 2.1, 3.3;
design sections 7.2, 10, and 10.1.

Synthetic offline tests only. No stores, providers, secrets, network, Drive,
queue, runtime, finance, or life state are accessed or mutated.
"""

from __future__ import annotations

from dataclasses import FrozenInstanceError, replace
from datetime import datetime, timezone
import unittest

from upoi_contracts import (
    AuthorityClass,
    BaselineRef,
    BlockerKind,
    ContractValidationError,
    DASHBOARD_PROHIBITED_WRITE_TARGETS,
    EvidenceTemporal,
    ObjectiveEvaluation,
    ObjectiveState,
    TypedBlocker,
    UPOI_OBJECTIVES,
    project_objective_dashboard,
    validate_objective_registry,
    validated_objective_registry,
)

UTC = timezone.utc
NOW = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
HASH_A = "a" * 64
HASH_B = "b" * 64


def _evaluation(
    objective_id: int,
    state: ObjectiveState,
    baseline: BaselineRef,
    reference: str,
    *,
    blocker: TypedBlocker | None = None,
) -> ObjectiveEvaluation:
    return ObjectiveEvaluation(
        objective_id=objective_id,
        state=state,
        baseline_ref=baseline,
        evidence_refs=(reference,),
        findings=(),
        evaluated_at=NOW,
        blockers=(blocker,) if blocker else (),
    )


def _blocker(kind: BlockerKind, code: str) -> TypedBlocker:
    return TypedBlocker(
        kind=kind,
        code=code,
        summary="Synthetic dashboard blocker.",
        next_owner_action="Owner reviews the named synthetic blocker.",
        authority_class=AuthorityClass.GOVERNANCE,
        raised_at=NOW,
    )


class ObjectiveRegistryTests(unittest.TestCase):
    def test_only_validated_canonical_registry_is_accepted(self) -> None:
        registry = validated_objective_registry()
        self.assertIs(registry, UPOI_OBJECTIVES)
        self.assertEqual(tuple(entry.id for entry in registry), tuple(range(1, 21)))
        self.assertEqual(len({entry.slug for entry in registry}), 20)
        self.assertTrue(all(len(entry.validation_question.replace("?", "").split()) == 5 for entry in registry))

    def test_missing_reordered_and_reworded_registry_entries_fail_closed(self) -> None:
        cases = (
            UPOI_OBJECTIVES[:-1],
            (UPOI_OBJECTIVES[1], UPOI_OBJECTIVES[0], *UPOI_OBJECTIVES[2:]),
            (*UPOI_OBJECTIVES[:-1], replace(UPOI_OBJECTIVES[-1], validation_question="Am I becoming truly autonomous?")),
        )
        for candidate in cases:
            with self.subTest(candidate=candidate[-1]), self.assertRaises(ContractValidationError):
                validate_objective_registry(candidate)


class DashboardProjectionTests(unittest.TestCase):
    def test_projection_renders_twenty_cards_and_separates_current_from_history(self) -> None:
        current = BaselineRef("baseline/current", HASH_A, "v-current")
        historical = BaselineRef("baseline/historical", HASH_B, "v-history")
        projection = project_objective_dashboard(
            (
                _evaluation(1, ObjectiveState.VERIFIED, current, "evidence/current"),
                _evaluation(5, ObjectiveState.VERIFIED, historical, "evidence/history"),
            ),
            current,
        )

        self.assertEqual(len(projection.cards), 20)
        self.assertEqual(projection.cards[0].status_label, "VERIFIED")
        self.assertTrue(projection.cards[0].is_completion)
        self.assertEqual(projection.cards[0].current_evidence[0].temporal, EvidenceTemporal.CURRENT_BASELINE)
        self.assertEqual(projection.cards[4].state, ObjectiveState.UNKNOWN)
        self.assertEqual(projection.cards[4].historical_evidence[0].temporal, EvidenceTemporal.HISTORICAL)
        self.assertEqual(projection.cards[4].historical_evaluations[0].baseline_ref, historical)

    def test_blocked_failed_and_regressed_states_remain_distinct_from_completion(self) -> None:
        baseline = BaselineRef("baseline/current", HASH_A, "v-current")
        projection = project_objective_dashboard(
            (
                _evaluation(1, ObjectiveState.BLOCKED_HUMAN, baseline, "evidence/human", blocker=_blocker(BlockerKind.HUMAN_GATE, "HUMAN_GATE_REQUIRED")),
                _evaluation(2, ObjectiveState.BLOCKED_DEPENDENCY, baseline, "evidence/dependency", blocker=_blocker(BlockerKind.DEPENDENCY, "DEPENDENCY_UNAVAILABLE")),
                _evaluation(3, ObjectiveState.FAILED, baseline, "evidence/failed"),
                _evaluation(4, ObjectiveState.REGRESSED, baseline, "evidence/regressed"),
            ),
            baseline,
        )

        self.assertEqual(
            [projection.cards[index].status_label for index in range(4)],
            ["BLOCKED_HUMAN", "BLOCKED_DEPENDENCY", "FAILED", "REGRESSED"],
        )
        self.assertTrue(projection.cards[0].is_blocked)
        self.assertTrue(projection.cards[1].is_blocked)
        self.assertFalse(any(projection.cards[index].is_completion for index in range(4)))
        self.assertEqual(projection.status_counts["BLOCKED_HUMAN"], 1)
        self.assertEqual(projection.status_counts["BLOCKED_DEPENDENCY"], 1)
        self.assertEqual(projection.status_counts["FAILED"], 1)
        self.assertEqual(projection.status_counts["REGRESSED"], 1)

    def test_read_model_is_immutable_and_has_no_domain_write_targets(self) -> None:
        baseline = BaselineRef("baseline/current", HASH_A, "v-current")
        evaluations = (_evaluation(1, ObjectiveState.VERIFIED, baseline, "evidence/current"),)
        projection = project_objective_dashboard(evaluations, baseline)

        self.assertEqual(DASHBOARD_PROHIBITED_WRITE_TARGETS, {"finance", "life", "signal", "queue", "Drive", "runtime"})
        self.assertFalse(hasattr(projection, "write"))
        self.assertFalse(hasattr(projection, "mutate"))
        self.assertEqual(evaluations[0].state, ObjectiveState.VERIFIED)
        self.assertEqual(UPOI_OBJECTIVES[0].id, 1)
        with self.assertRaises(FrozenInstanceError):
            projection.cards = ()  # type: ignore[misc]
        with self.assertRaises(FrozenInstanceError):
            projection.cards[0].current_evaluation = None  # type: ignore[misc]

    def test_duplicate_current_evaluations_and_unknown_objectives_fail_closed(self) -> None:
        baseline = BaselineRef("baseline/current", HASH_A, "v-current")
        duplicate = (
            _evaluation(1, ObjectiveState.VERIFIED, baseline, "evidence/one"),
            _evaluation(1, ObjectiveState.FAILED, baseline, "evidence/two"),
        )
        with self.assertRaises(ContractValidationError):
            project_objective_dashboard(duplicate, baseline)
        with self.assertRaises(ContractValidationError):
            project_objective_dashboard((_evaluation(21, ObjectiveState.UNKNOWN, baseline, "evidence/unknown"),), baseline)


if __name__ == "__main__":
    unittest.main()
