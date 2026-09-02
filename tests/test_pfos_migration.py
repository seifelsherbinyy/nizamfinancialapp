"""
NIZAM · synthetic MAL/PFOS migration mapper tests
Owning contract: UPOI task 6.2; requirements 2.1–2.3 and 3.1–3.3; design §11.1.
Phase: UPOI task 6.2 — offline synthetic staging only.

These tests use in-memory redacted records. They do not read ledgers, call providers, write
finance state, start dual-write, cut over, access secrets, or use the network.
"""

from __future__ import annotations

from dataclasses import replace
import json
import unittest

from src.server.pfos_migration import (
    LegacyMalRecord,
    MigrationMapperError,
    PfosCandidate,
    SyntheticMigrationApproval,
    inventory_legacy_mal_schema,
    map_synthetic_mal_to_pfos,
    stage_synthetic_mal_migration,
)


APPROVAL = SyntheticMigrationApproval()
RECORDS = (
    LegacyMalRecord(
        "synthetic:mal/txn-001",
        "transaction",
        "1.000",
        "EGP_MAJOR_DECIMAL_TEXT",
        "EGP",
        "mal-synthetic-v1",
    ),
    LegacyMalRecord(
        "synthetic:mal/txn-002",
        "transaction",
        "-0.125",
        "EGP_MAJOR_DECIMAL_TEXT",
        "EGP",
        "mal-synthetic-v1",
    ),
    LegacyMalRecord(
        "synthetic:mal/txn-003",
        "transaction",
        9007199254740991,
        "EGP_MILLIUNITS",
        "EGP",
        "mal-synthetic-v1",
    ),
)
EXPECTED = (
    PfosCandidate("synthetic:pfos-candidate/txn-001", "synthetic:mal/txn-001", "transaction", 1000, "EGP", "mal-synthetic-v1"),
    PfosCandidate("synthetic:pfos-candidate/txn-002", "synthetic:mal/txn-002", "transaction", -125, "EGP", "mal-synthetic-v1"),
    PfosCandidate("synthetic:pfos-candidate/txn-003", "synthetic:mal/txn-003", "transaction", 9007199254740991, "EGP", "mal-synthetic-v1"),
)


def code(callable_obj, *args, **kwargs) -> str:
    with unittest.TestCase().assertRaises(MigrationMapperError) as raised:
        callable_obj(*args, **kwargs)
    return raised.exception.code


class SyntheticPfosMigrationTests(unittest.TestCase):
    def test_inventory_is_static_and_declares_units_without_opening_a_ledger(self) -> None:
        inventory = inventory_legacy_mal_schema()
        self.assertEqual(inventory.read_mode, "READ_ONLY_SYNTHETIC_INPUT")
        self.assertEqual(inventory.monetary_fields, ("amount",))
        self.assertEqual(inventory.source_units, ("EGP_MAJOR_DECIMAL_TEXT", "EGP_MILLIUNITS"))

    def test_mapping_proves_exact_egp_milliunit_conversion(self) -> None:
        candidates = map_synthetic_mal_to_pfos(RECORDS)
        self.assertEqual([candidate.amount_milliunits for candidate in candidates], [1000, -125, 9007199254740991])
        self.assertEqual([candidate.unit for candidate in candidates], ["milliunits"] * 3)
        # The source tuple remains unchanged; mapping is not a rewrite in disguise.
        self.assertEqual(RECORDS[0].amount, "1.000")

    def test_exact_output_parity_returns_staged_receipt_without_effect(self) -> None:
        candidates, receipt = stage_synthetic_mal_migration(RECORDS, EXPECTED, approval=APPROVAL)
        self.assertEqual(candidates, tuple(sorted(EXPECTED, key=lambda item: item.candidate_ref)))
        self.assertEqual(receipt.status, "AWAITING_HUMAN_CUTOVER")
        self.assertTrue(receipt.exact_milliunit_conversion)
        self.assertTrue(receipt.deterministic_output_parity)
        self.assertTrue(receipt.staged_only)
        self.assertTrue(receipt.legacy_source_unchanged)
        self.assertFalse(receipt.canonical_writer_changed)
        self.assertFalse(receipt.dual_write_started)
        self.assertFalse(receipt.cutover_performed)
        serialized = receipt.serialize()
        self.assertEqual(serialized, receipt.serialize())
        self.assertEqual(json.loads(serialized)["status"], "AWAITING_HUMAN_CUTOVER")

    def test_parity_mismatch_is_refused_and_does_not_stage_candidates(self) -> None:
        wrong = replace(EXPECTED[0], amount_milliunits=1001)
        candidates, receipt = stage_synthetic_mal_migration(RECORDS, (wrong, *EXPECTED[1:]), approval=APPROVAL)
        self.assertEqual(candidates, ())
        self.assertEqual(receipt.status, "REFUSED_PARITY_MISMATCH")
        self.assertFalse(receipt.deterministic_output_parity)
        self.assertNotEqual(receipt.staged_hash, receipt.expected_hash)
        self.assertEqual(receipt.candidate_record_count, 0)

    def test_real_source_like_refs_and_lossy_values_fail_closed(self) -> None:
        self.assertEqual(
            code(
                LegacyMalRecord,
                "ledger:/real/1",
                "transaction",
                "1.000",
                "EGP_MAJOR_DECIMAL_TEXT",
                "EGP",
                "v1",
            ),
            "SYNTHETIC_RECORD_REQUIRED",
        )
        self.assertEqual(
            code(
                LegacyMalRecord,
                "synthetic:mal/bad",
                "transaction",
                "1.0001",
                "EGP_MAJOR_DECIMAL_TEXT",
                "EGP",
                "v1",
            ),
            "LOSSLESS_AMOUNT_INVALID",
        )
        self.assertEqual(
            code(
                LegacyMalRecord,
                "synthetic:mal/float",
                "transaction",
                1.0,
                "EGP_MILLIUNITS",
                "EGP",
                "v1",
            ),
            "MILLIUNITS_TEXT_INVALID",
        )

    def test_missing_or_effectful_scope_is_rejected(self) -> None:
        with self.assertRaises(MigrationMapperError) as raised:
            stage_synthetic_mal_migration(RECORDS, EXPECTED)
        self.assertEqual(raised.exception.code, "MIGRATION_APPROVAL_REQUIRED")
        self.assertEqual(
            code(SyntheticMigrationApproval, canonical_write=True),
            "MIGRATION_EFFECT_FORBIDDEN",
        )

    def test_duplicate_source_refs_are_rejected_before_staging(self) -> None:
        self.assertEqual(code(map_synthetic_mal_to_pfos, (RECORDS[0], RECORDS[0])), "DUPLICATE_RECORD_REF")


if __name__ == "__main__":
    unittest.main()
