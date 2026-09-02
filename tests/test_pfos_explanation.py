"""
NIZAM · Non-authoritative PFOS explanation composition tests
Owning contract: UPOI requirements 2.2, 2.4; design §§6.2, 7.5, 8.1
Phase: UPOI task 3.3

Synthetic offline tests only. Explanations are reply-layer text with deterministic
PFOS references; they are not financial values, persistence records, or decision input.
"""

from __future__ import annotations

import unittest

from src.server.pfos_port import (
    DeterministicFinancePort,
    FinanceDecisionRequest,
    FinanceDecisionResult,
    FinancialSnapshot,
    NonAuthoritativeExplanation,
    NonAuthoritativeExplanationError,
    ProvenanceRecord,
    compose_non_authoritative_explanation,
)


PROVENANCE = ProvenanceRecord(
    source_ref="synthetic-pfos-source",
    source_version="synthetic-pfos-version",
    observed_at="2026-01-01T00:00:00Z",
    content_hash="synthetic-content-hash",
)
SNAPSHOT = FinancialSnapshot(
    version_ref="synthetic-snapshot-ref",
    observed_at="2026-01-01T00:00:00Z",
    values={"synthetic_balance": 987654},
    provenance=PROVENANCE,
)
DECISION = FinanceDecisionResult(
    result_ref="synthetic-decision-ref",
    source_version="synthetic-pfos-version",
    decision={"status": "synthetic-approved"},
    provenance=PROVENANCE,
)


class PfosExplanationCompositionTests(unittest.TestCase):
    def test_snapshot_explanation_cites_reference_and_has_no_financial_fields(self) -> None:
        explanation = compose_non_authoritative_explanation(
            SNAPSHOT,
            "The deterministic result is available for review.",
        )

        self.assertIsInstance(explanation, NonAuthoritativeExplanation)
        self.assertEqual(explanation.authority_class, "EVIDENCE_ONLY")
        self.assertEqual(explanation.cited_result_refs, ("synthetic-snapshot-ref",))
        self.assertNotIn("987654", explanation.render_reply())
        self.assertFalse(hasattr(explanation, "values"))
        self.assertFalse(hasattr(explanation, "decision"))
        self.assertIn("synthetic-snapshot-ref", explanation.render_reply())

    def test_port_composes_decision_explanation_without_recomputing_or_rewriting_result(self) -> None:
        port = DeterministicFinancePort(None)

        explanation = port.compose_explanation(DECISION, "The deterministic decision is ready for review.")

        self.assertEqual(explanation.text, "The deterministic decision is ready for review.")
        self.assertEqual(explanation.cited_result_refs, ("synthetic-decision-ref",))
        self.assertEqual(DECISION.decision, {"status": "synthetic-approved"})
        self.assertEqual(DECISION.provenance, PROVENANCE)

    def test_explanation_cannot_cross_persistence_or_decision_boundaries(self) -> None:
        explanation = compose_non_authoritative_explanation(SNAPSHOT, "Synthetic rationale only.")

        with self.assertRaises(NonAuthoritativeExplanationError) as persistence_error:
            explanation.as_persistence_input()
        with self.assertRaises(NonAuthoritativeExplanationError) as decision_error:
            explanation.as_decision_input()
        with self.assertRaises(NonAuthoritativeExplanationError) as nested_error:
            FinanceDecisionRequest("synthetic-request", {"explanation": explanation})

        self.assertEqual(persistence_error.exception.code, "EXPLANATION_PERSISTENCE_FORBIDDEN")
        self.assertEqual(decision_error.exception.code, "EXPLANATION_DECISION_INPUT_FORBIDDEN")
        self.assertEqual(nested_error.exception.code, "EXPLANATION_DECISION_INPUT_FORBIDDEN")

    def test_invalid_explanation_or_result_is_refused(self) -> None:
        with self.assertRaises(NonAuthoritativeExplanationError) as empty_error:
            compose_non_authoritative_explanation(SNAPSHOT, "   ")
        with self.assertRaises(NonAuthoritativeExplanationError) as result_error:
            compose_non_authoritative_explanation(object(), "Synthetic rationale.")  # type: ignore[arg-type]

        self.assertEqual(empty_error.exception.code, "EXPLANATION_TEXT_INVALID")
        self.assertEqual(result_error.exception.code, "EXPLANATION_RESULT_INVALID")


if __name__ == "__main__":
    unittest.main()
