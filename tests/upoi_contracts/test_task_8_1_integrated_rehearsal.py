"""Task 8.1 integrated synthetic UPOI rehearsal tests.

Owning contract: UPOI task 8.1; requirements 1.1-1.4, 2.1-2.4, and 3.1-3.4.
Phase: offline synthetic integration only. The test composes tasks 1-7 with
in-memory providers and redacted references; it uses no network, secrets,
credentials, live providers, persistence, deployment, commits, or pushes.
"""

from __future__ import annotations

import unittest

from src.server.drive_archive import DRIVE_FILE_SCOPE
from src.server.upoi_rehearsal import run_synthetic_end_to_end_rehearsal
from upoi_contracts import ExecutionOutcome, LoopState


class IntegratedOfflineRehearsalTests(unittest.TestCase):
    """Exercise the complete task 8.1 composition through one public fixture."""

    def test_rehearsal_covers_read_only_governance_and_effect_boundaries(self) -> None:
        result = run_synthetic_end_to_end_rehearsal()

        self.assertEqual(
            dict(result.read_only_values),
            {"balance_milliunits": 123400, "one_egp_milliunits": 1000},
        )
        self.assertEqual(result.read_only_version_ref, "synthetic:pfos/snapshot-v1")
        self.assertEqual(result.read_only_source_ref, "synthetic:pfos/source-v1")
        self.assertEqual(result.pfos_evidence_source_version, "synthetic-pfos-v1")

        self.assertEqual(result.blocked_effect_count, 0)
        self.assertEqual(result.blocked_target_mutation_count, 0)
        self.assertEqual(result.approved_effect_outcome, ExecutionOutcome.SUCCEEDED)
        self.assertEqual(result.approved_target_mutation_count, 1)
        self.assertEqual(result.queue_replay.canonical_effect_count, 1)
        self.assertEqual(result.queue_replay.target_mutation_count, 1)
        self.assertTrue(result.queue_replay.first_enqueue_committed)
        self.assertTrue(result.queue_replay.duplicate_enqueue_no_op)
        self.assertTrue(result.queue_replay.dispatcher_replayed)

    def test_rehearsal_refuses_missing_authority_data_and_provenance(self) -> None:
        result = run_synthetic_end_to_end_rehearsal()

        self.assertTrue(result.pfos_unavailable.refused)
        self.assertEqual(result.pfos_unavailable.code, "PFOS_SOURCE_UNAVAILABLE")
        self.assertIsNone(result.pfos_unavailable.estimate)
        self.assertTrue(result.provenance_refusal.refused)
        self.assertIn("INCOMPLETE_PROVENANCE", result.provenance_refusal.code)
        self.assertIn("RESTRICTED_CONTEXT_EGRESS", result.provenance_refusal.code)
        self.assertEqual(result.provenance_refusal.provider_bound_count, 0)

    def test_rehearsal_proves_archive_migration_rollback_and_loop_controls(self) -> None:
        result = run_synthetic_end_to_end_rehearsal()

        self.assertEqual(result.archive_scope, DRIVE_FILE_SCOPE)
        self.assertTrue(result.archive_read_back_verified)
        self.assertTrue(result.archive_receipt_ref.startswith("synthetic:archive/"))
        self.assertEqual(result.migration_status, "AWAITING_HUMAN_CUTOVER")
        self.assertTrue(result.migration_staged_only)
        self.assertTrue(result.migration_source_unchanged)
        self.assertEqual(result.rollback_status, "VERIFIED")
        self.assertEqual(result.rollback_reclaimed_keys, ("synthetic:idempotency/reclaim-1",))
        self.assertEqual(result.rollback_failed_candidates, ("synthetic:pfos-candidate/failed-1",))

        self.assertEqual(result.loop_state, LoopState.PASSED)
        self.assertEqual(
            result.loop_checks_executed,
            ("exit", "positive", "negative", "regression"),
        )
        self.assertEqual(result.loop_evidence_event_count, 7)
        self.assertEqual(result.dashboard_card_count, 20)
        self.assertEqual(result.dashboard_baseline_ref, "synthetic:baseline/upoi-task-8-1")
        self.assertEqual(result.baseline_hash_before, result.baseline_hash_after)


if __name__ == "__main__":
    unittest.main()
