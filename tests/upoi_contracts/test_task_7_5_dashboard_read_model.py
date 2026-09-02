"""Task 7.5 tests for the immutable objective dashboard read model.

Owning contract: UPOI task 7.5; requirements 1.3, 1.4, 2.1, 3.1, 3.4;
design sections 7.5 and 10. Synthetic offline tests only: no providers,
network, secrets, persistence, deployment, or domain-state mutation.
"""

from __future__ import annotations

from dataclasses import FrozenInstanceError
from datetime import datetime, timezone
import json
import unittest

from upoi_contracts import (
    AuthorityClass,
    BaselineManifest,
    BaselineRef,
    BlockerKind,
    DASHBOARD_PROHIBITED_WRITE_TARGETS,
    ObjectiveEvaluation,
    ObjectiveState,
    TypedBlocker,
    UPOI_OBJECTIVES,
    build_complete_loop_adapter,
    create_complete_loop_baseline,
    project_objective_dashboard,
)
from src.server.pfos_port import (
    FinancialSnapshot,
    ProvenanceRecord,
    serialize_financial_snapshot,
)

UTC = timezone.utc
NOW = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
HASH_CURRENT = "a" * 64
HASH_HISTORY = "b" * 64


def _baseline() -> BaselineManifest:
    return create_complete_loop_baseline(
        baseline_id="baseline:task-7-5",
        version="synthetic-v1",
        source_revision_refs=("revision:synthetic",),
        contract_refs=("contract:upoi-task-7-5",),
        spec_hashes=(HASH_CURRENT,),
        schema_versions=("schema:loop-v1",),
        fixture_versions=("fixture:dashboard-v1",),
        created_at=NOW,
    )


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


class DashboardReadModelRenderingTests(unittest.TestCase):
    def test_complete_loop_adapter_renders_exactly_twenty_canonical_objectives(self) -> None:
        baseline = _baseline()
        adapter = build_complete_loop_adapter(baseline)
        projection = adapter.project_dashboard(
            (_evaluation(10, ObjectiveState.VERIFIED, adapter.baseline_ref, "pfos:synthetic"),)
        )

        self.assertEqual(len(projection.cards), 20)
        self.assertEqual(
            tuple(card.definition.id for card in projection.cards),
            tuple(range(1, 21)),
        )
        self.assertTrue(
            all(
                card.definition is UPOI_OBJECTIVES[card.definition.id - 1]
                for card in projection.cards
            )
        )
        self.assertEqual(
            tuple(card.definition.validation_question for card in projection.cards),
            tuple(entry.validation_question for entry in UPOI_OBJECTIVES),
        )

    def test_current_and_historical_evidence_are_separate_even_for_one_objective(self) -> None:
        current = BaselineRef("baseline/current", HASH_CURRENT, "v-current")
        historical = BaselineRef("baseline/history", HASH_HISTORY, "v-history")
        projection = project_objective_dashboard(
            (
                _evaluation(1, ObjectiveState.AT_RISK, current, "evidence/current"),
                _evaluation(1, ObjectiveState.VERIFIED, historical, "evidence/history"),
                _evaluation(2, ObjectiveState.VERIFIED, historical, "evidence/history-only"),
            ),
            current,
        )

        current_card = projection.cards[0]
        historical_only_card = projection.cards[1]
        self.assertEqual(current_card.state, ObjectiveState.AT_RISK)
        self.assertEqual(current_card.current_evidence[0].reference, "evidence/current")
        self.assertEqual(current_card.current_evidence[0].baseline_ref, current)
        self.assertEqual(current_card.historical_evidence[0].reference, "evidence/history")
        self.assertEqual(current_card.historical_evidence[0].baseline_ref, historical)
        self.assertEqual(historical_only_card.state, ObjectiveState.UNKNOWN)
        self.assertEqual(
            historical_only_card.historical_evaluations[0].state,
            ObjectiveState.VERIFIED,
        )

    def test_read_model_is_read_only_and_preserves_inputs(self) -> None:
        baseline = _baseline().reference
        evaluation = _evaluation(1, ObjectiveState.VERIFIED, baseline, "evidence/current")
        projection = project_objective_dashboard((evaluation,), baseline)

        self.assertEqual(
            DASHBOARD_PROHIBITED_WRITE_TARGETS,
            {"finance", "life", "signal", "queue", "Drive", "runtime"},
        )
        self.assertEqual(evaluation.state, ObjectiveState.VERIFIED)
        self.assertFalse(any(hasattr(projection, name) for name in ("write", "mutate", "delete")))
        with self.assertRaises(FrozenInstanceError):
            projection.cards = ()  # type: ignore[misc]
        with self.assertRaises(FrozenInstanceError):
            projection.cards[0].current_evaluation = None  # type: ignore[misc]
        with self.assertRaises(FrozenInstanceError):
            projection.cards[0].current_evidence = ()  # type: ignore[misc]


class FinancialReadModelTests(unittest.TestCase):
    def test_financial_read_model_keeps_integer_milliunits_and_formats_wire_text_exactly(self) -> None:
        snapshot = FinancialSnapshot(
            version_ref="pfos:snapshot:synthetic",
            observed_at="2026-01-02T03:04:05Z",
            values={"one_egp": 1000, "negative": -125},
            provenance=ProvenanceRecord(
                source_ref="pfos:source:synthetic",
                source_version="pfos-v1",
                observed_at="2026-01-02T03:04:05Z",
                content_hash="synthetic-content-hash",
            ),
        )

        wire = json.loads(serialize_financial_snapshot(snapshot))
        self.assertEqual(snapshot.values, {"one_egp": 1000, "negative": -125})
        self.assertEqual(wire["values"], {"negative": "-125", "one_egp": "1000"})
        self.assertNotIn("1.0", json.dumps(wire["values"]))

    def test_financial_objective_card_exposes_only_read_evidence_reference(self) -> None:
        baseline = _baseline().reference
        projection = project_objective_dashboard(
            (_evaluation(10, ObjectiveState.VERIFIED, baseline, "pfos:snapshot:synthetic"),),
            baseline,
        )
        card = projection.cards[9]

        self.assertEqual(card.current_evidence[0].reference, "pfos:snapshot:synthetic")
        self.assertFalse(hasattr(card, "values"))
        self.assertFalse(hasattr(card, "amount"))


class DashboardBlockerStateTests(unittest.TestCase):
    def test_blockers_failures_and_regressions_remain_distinct_from_completion(self) -> None:
        baseline = _baseline().reference
        projection = project_objective_dashboard(
            (
                _evaluation(
                    1,
                    ObjectiveState.BLOCKED_HUMAN,
                    baseline,
                    "evidence/human",
                    blocker=_blocker(BlockerKind.HUMAN_GATE, "HUMAN_GATE_REQUIRED"),
                ),
                _evaluation(
                    2,
                    ObjectiveState.BLOCKED_DEPENDENCY,
                    baseline,
                    "evidence/dependency",
                    blocker=_blocker(BlockerKind.DEPENDENCY, "DEPENDENCY_UNAVAILABLE"),
                ),
                _evaluation(3, ObjectiveState.FAILED, baseline, "evidence/failed"),
                _evaluation(4, ObjectiveState.REGRESSED, baseline, "evidence/regressed"),
                _evaluation(5, ObjectiveState.VERIFIED, baseline, "evidence/verified"),
            ),
            baseline,
        )

        self.assertEqual(
            [projection.cards[index].status_label for index in range(5)],
            ["BLOCKED_HUMAN", "BLOCKED_DEPENDENCY", "FAILED", "REGRESSED", "VERIFIED"],
        )
        self.assertTrue(projection.cards[0].is_blocked)
        self.assertTrue(projection.cards[1].is_blocked)
        self.assertFalse(projection.cards[2].is_completion)
        self.assertFalse(projection.cards[3].is_completion)
        self.assertTrue(projection.cards[4].is_completion)
        self.assertEqual(projection.status_counts["BLOCKED_HUMAN"], 1)
        self.assertEqual(projection.status_counts["BLOCKED_DEPENDENCY"], 1)
        self.assertEqual(projection.status_counts["FAILED"], 1)
        self.assertEqual(projection.status_counts["REGRESSED"], 1)
