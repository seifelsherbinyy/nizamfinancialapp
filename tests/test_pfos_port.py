"""
NIZAM · Deterministic PFOS boundary tests
Owning contract: UPOI requirements 2.1–2.4; design §6.2, §7.5
Phase: UPOI task 3.1

These tests inject a synthetic PFOS source. They prove delegation and fail-closed
unavailability without exercising a provider, a store, a model, or financial arithmetic.
"""

from __future__ import annotations

import unittest
from dataclasses import dataclass
from src.server.pfos_port import (
    DeterministicFinancePort,
    FinanceDecisionRequest,
    FinancePortError,
    FinanceQuery,
    FinanceSourceUnavailableError,
    FinanceDecisionResult,
    FinancialSnapshot,
    ProvenanceRecord,
)


PROVENANCE = ProvenanceRecord(
    source_ref="pfos-source-ref",
    source_version="pfos-version-ref",
    observed_at="2026-01-01T00:00:00Z",
    content_hash="synthetic-content-hash",
)
SNAPSHOT = FinancialSnapshot(
    version_ref="pfos-snapshot-version",
    observed_at="2026-01-01T00:00:00Z",
    values={"synthetic_balance": 1234},
    provenance=PROVENANCE,
)
DECISION = FinanceDecisionResult(
    result_ref="pfos-decision-ref",
    source_version="pfos-version-ref",
    decision={"status": "synthetic-approved"},
    provenance=PROVENANCE,
)
QUERY = FinanceQuery(query_ref="query-ref", filters={"scope": "synthetic"})
REQUEST = FinanceDecisionRequest(request_ref="request-ref", inputs={"kind": "synthetic"})


@dataclass
class RecordingPfosSource:
    snapshot: FinancialSnapshot = SNAPSHOT
    decision: FinanceDecisionResult = DECISION
    unavailable_operation: str | None = None
    snapshot_queries: list[FinanceQuery] | None = None
    decision_requests: list[FinanceDecisionRequest] | None = None

    def __post_init__(self) -> None:
        self.snapshot_queries = []
        self.decision_requests = []

    def read_financial_snapshot(self, query: FinanceQuery) -> FinancialSnapshot:
        assert self.snapshot_queries is not None
        self.snapshot_queries.append(query)
        if self.unavailable_operation == "read_financial_snapshot":
            raise FinanceSourceUnavailableError("read_financial_snapshot")
        return self.snapshot

    def evaluate_decision(self, request: FinanceDecisionRequest) -> FinanceDecisionResult:
        assert self.decision_requests is not None
        self.decision_requests.append(request)
        if self.unavailable_operation == "evaluate_decision":
            raise FinanceSourceUnavailableError("evaluate_decision")
        return self.decision


class DeterministicFinancePortTests(unittest.TestCase):
    def test_snapshot_delegates_without_rebuilding_result_or_provenance(self) -> None:
        source = RecordingPfosSource()
        port = DeterministicFinancePort(source)

        result = port.read_financial_snapshot(QUERY)

        self.assertIs(result, SNAPSHOT)
        self.assertIs(result.provenance, PROVENANCE)
        self.assertEqual(source.snapshot_queries, [QUERY])
        self.assertEqual(result.version_ref, "pfos-snapshot-version")

    def test_decision_delegates_without_interpreting_payload(self) -> None:
        source = RecordingPfosSource()
        port = DeterministicFinancePort(source)

        result = port.evaluate_decision(REQUEST)

        self.assertIs(result, DECISION)
        self.assertIs(result.provenance, PROVENANCE)
        self.assertEqual(source.decision_requests, [REQUEST])
        self.assertEqual(result.source_version, "pfos-version-ref")

    def test_missing_source_refuses_before_any_fallback_can_run(self) -> None:
        port = DeterministicFinancePort(None)

        with self.assertRaises(FinanceSourceUnavailableError) as snapshot_error:
            port.read_financial_snapshot(QUERY)
        with self.assertRaises(FinanceSourceUnavailableError) as decision_error:
            port.evaluate_decision(REQUEST)

        self.assertEqual(snapshot_error.exception.code, "PFOS_SOURCE_UNAVAILABLE")
        self.assertEqual(snapshot_error.exception.operation, "read_financial_snapshot")
        self.assertEqual(decision_error.exception.code, "PFOS_SOURCE_UNAVAILABLE")
        self.assertEqual(decision_error.exception.operation, "evaluate_decision")
        self.assertIsInstance(snapshot_error.exception, FinancePortError)

    def test_typed_source_unavailability_is_reported_without_substitution(self) -> None:
        source = RecordingPfosSource(unavailable_operation="read_financial_snapshot")
        port = DeterministicFinancePort(source)

        with self.assertRaises(FinanceSourceUnavailableError) as error:
            port.read_financial_snapshot(QUERY)

        self.assertEqual(error.exception.code, "PFOS_SOURCE_UNAVAILABLE")
        self.assertEqual(error.exception.operation, "read_financial_snapshot")
        self.assertEqual(source.snapshot_queries, [QUERY])

    def test_unrelated_source_failures_are_not_hidden_as_financial_results(self) -> None:
        class BrokenSource(RecordingPfosSource):
            def evaluate_decision(self, request: FinanceDecisionRequest) -> FinanceDecisionResult:
                raise ValueError("synthetic source contract failure")

        with self.assertRaises(ValueError):
            DeterministicFinancePort(BrokenSource()).evaluate_decision(REQUEST)


if __name__ == "__main__":
    unittest.main()
