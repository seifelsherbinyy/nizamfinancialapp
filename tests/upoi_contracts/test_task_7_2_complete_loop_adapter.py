"""Focused synthetic tests for UPOI task 7.2 complete-loop adapter.

Owning contract: UPOI task 7.2; requirements 1.3, 1.4, 2.1, 2.2, 3.4;
design sections 10.1, 10.2, and 18. Offline only: no providers, network,
secrets, persistence, deployment, live finance, or migration cutover.
"""

from __future__ import annotations

from datetime import datetime, timezone
import unittest

from upoi_contracts import (
    AuthorityClass,
    BaselineManifest,
    ContractValidationError,
    FINANCIAL_OBJECTIVE_ID,
    MAL_PFOS_MIGRATION_ALIAS,
    PFOS_MAL_ALIAS,
    ObjectiveState,
    PfosEvidenceBinding,
    UPOI_OBJECTIVES,
    build_complete_loop_adapter,
    create_complete_loop_baseline,
)
from src.server.pfos_port import (
    DeterministicFinancePort,
    FinanceQuery,
    FinancialSnapshot,
    ProvenanceRecord,
)

UTC = timezone.utc
NOW = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
HASH_A = "a" * 64


def _baseline() -> BaselineManifest:
    return create_complete_loop_baseline(
        baseline_id="baseline:task-7-2",
        version="synthetic-v1",
        source_revision_refs=("revision:synthetic",),
        contract_refs=("contract:upoi-task-7-2",),
        spec_hashes=(HASH_A,),
        schema_versions=("schema:loop-v1",),
        fixture_versions=("fixture:loop-v1",),
        created_at=NOW,
    )


class CompleteLoopAdapterTests(unittest.TestCase):
    def test_builds_twenty_complete_loops_from_one_validated_registry(self) -> None:
        baseline = _baseline()
        adapter = build_complete_loop_adapter(baseline)

        self.assertIs(adapter.registry, UPOI_OBJECTIVES)
        self.assertEqual(tuple(entry.definition.loop_id for entry in adapter.entries), tuple(f"UPOI-L{i:02d}" for i in range(1, 21)))
        self.assertEqual(len(adapter.baseline.check_inventory), 80)
        self.assertEqual(adapter.baseline_ref, baseline.reference)
        for entry in adapter.entries:
            definition = entry.definition
            self.assertEqual(definition.immutable_baseline_ref, baseline.reference)
            self.assertTrue(definition.bounded_allowed_scope)
            self.assertTrue(definition.bounded_prohibited_scope)
            self.assertTrue(definition.exit_criteria)
            self.assertTrue(definition.positive_control)
            self.assertTrue(definition.negative_test)
            self.assertTrue(definition.regression_check)
            self.assertEqual(definition.dashboard_rerun.objective_id, definition.objective_id)
            self.assertEqual(definition.dashboard_rerun.baseline_ref, baseline.reference)
            self.assertEqual(definition.dashboard_rerun.expected_terminal_states, (ObjectiveState.VERIFIED,))
            self.assertTrue(definition.rollback_ref)
            self.assertEqual(entry.blocker_template.authority_class, AuthorityClass.GOVERNANCE)
            self.assertTrue(entry.blocker_template.next_owner_action)

    def test_admit_all_preserves_baseline_and_uses_resolvable_rollbacks(self) -> None:
        baseline = _baseline()
        adapter = build_complete_loop_adapter(baseline)
        records = adapter.admit_all(opened_at=NOW)

        self.assertEqual(len(records), 20)
        self.assertTrue(all(record.definition.immutable_baseline_ref == baseline.reference for record in records))
        self.assertEqual(baseline.reference, adapter.baseline_ref)
        self.assertEqual(len(records[0].evidence_chain.events), 1)

    def test_dashboard_rerun_uses_same_canonical_registry_without_a_parallel_list(self) -> None:
        baseline = _baseline()
        adapter = build_complete_loop_adapter(baseline)
        projection = adapter.project_dashboard(())

        self.assertEqual(len(projection.cards), 20)
        self.assertEqual(tuple(card.definition.id for card in projection.cards), tuple(range(1, 21)))
        self.assertIs(projection.cards[9].definition, UPOI_OBJECTIVES[9])

    def test_financial_objective_is_bound_to_read_only_pfos_and_aliases(self) -> None:
        baseline = _baseline()
        adapter = build_complete_loop_adapter(baseline)
        binding = adapter.entry(FINANCIAL_OBJECTIVE_ID).financial_evidence

        self.assertIsNotNone(binding)
        assert binding is not None
        self.assertEqual(binding.source_alias, PFOS_MAL_ALIAS)
        self.assertEqual(binding.migration_alias, MAL_PFOS_MIGRATION_ALIAS)
        self.assertTrue(binding.read_only)
        self.assertEqual(binding.authority, AuthorityClass.DETERMINISTIC_DOMAIN)

        class SyntheticPfosSource:
            def __init__(self) -> None:
                self.queries: list[FinanceQuery] = []

            def read_financial_snapshot(self, query: FinanceQuery) -> FinancialSnapshot:
                self.queries.append(query)
                return FinancialSnapshot(
                    version_ref="pfos:snapshot:synthetic-v1",
                    observed_at="2026-01-02T03:04:05Z",
                    values={"synthetic_balance": 1000},
                    provenance=ProvenanceRecord(
                        source_ref="pfos:source:synthetic",
                        source_version="pfos-v1",
                        observed_at="2026-01-02T03:04:05Z",
                        content_hash="synthetic-content",
                    ),
                )

        source = SyntheticPfosSource()
        receipt = adapter.read_financial_evidence(DeterministicFinancePort(source))
        self.assertEqual(receipt.snapshot_ref, "pfos:snapshot:synthetic-v1")
        self.assertEqual(receipt.source_version, "pfos-v1")
        self.assertEqual(source.queries[0].query_ref, binding.query_ref)
        self.assertNotIn("synthetic_balance", receipt.__dataclass_fields__)

    def test_missing_baseline_inventory_and_alias_rewrites_fail_closed(self) -> None:
        baseline = _baseline()
        incomplete = BaselineManifest.create(
            baseline_id=baseline.baseline_id,
            version=baseline.version,
            source_revision_refs=baseline.source_revision_refs,
            check_inventory=baseline.check_inventory[:-1],
            contract_refs=baseline.contract_refs,
            spec_hashes=baseline.spec_hashes,
            schema_versions=baseline.schema_versions,
            fixture_versions=baseline.fixture_versions,
            created_at=baseline.created_at,
        )
        with self.assertRaises(ContractValidationError):
            build_complete_loop_adapter(incomplete)
        with self.assertRaises(ContractValidationError):
            PfosEvidenceBinding(objective_id=FINANCIAL_OBJECTIVE_ID, query_ref="pfos:q", source_alias="MAL")


if __name__ == "__main__":
    unittest.main()
