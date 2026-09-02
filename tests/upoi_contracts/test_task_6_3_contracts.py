"""Task 6.3 archive and migration contract tests.

Owning contract: UPOI task 6.3; requirements 1.2, 1.3, 2.3, and 3.3; design sections 6.6,
9.3, and 11.1.
Phase: UPOI task 6.3 — synthetic offline contract tests only.

These tests use injected in-memory archive behavior and synthetic MAL/PFOS records. They do
not call Drive, providers, networks, secrets, deployment controls, or canonical writers.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
import unittest

from src.server.drive_archive import (
    ArchiveApproval,
    ArchiveArtifact,
    DriveArchiveError,
    DriveArchivePort,
    DRIVE_FILE_SCOPE,
    ReadBackReceipt,
    StagedArtifact,
    UploadReceipt,
)
from src.server.pfos_migration import (
    LegacyMalRecord,
    MigrationMapperError,
    PfosCandidate,
    SyntheticMigrationApproval,
    stage_synthetic_mal_migration,
)


ARCHIVE_APPROVAL = ArchiveApproval(
    DRIVE_FILE_SCOPE, frozenset({"public", "private", "restricted"})
)
MIGRATION_APPROVAL = SyntheticMigrationApproval()


@dataclass
class ContractProvider:
    """Synthetic injected provider with deterministic, controllable read-back."""

    scopes: frozenset[str] = frozenset({DRIVE_FILE_SCOPE})
    mismatch: str | None = None

    def __post_init__(self) -> None:
        self.uploads: list[dict[str, object]] = []
        self.rows: dict[str, ReadBackReceipt] = {}
        self.sequence = 0

    def upload(self, **kwargs: object) -> UploadReceipt:
        self.uploads.append(kwargs)
        self.sequence += 1
        remote_ref = f"synthetic:archive/{self.sequence}"
        receipt = UploadReceipt(remote_ref, str(kwargs["idempotency_key"]), f"destination:v{self.sequence}")
        content_hash = str(kwargs["content_hash"])
        artifact_version = str(kwargs["artifact_version"])
        destination_version = receipt.destination_version
        if self.mismatch == "hash":
            content_hash = "f" * 64
        elif self.mismatch == "artifact_version":
            artifact_version = "wrong-version"
        elif self.mismatch == "destination_version":
            destination_version = "wrong-destination"
        self.rows[remote_ref] = ReadBackReceipt(
            remote_ref, destination_version, artifact_version, content_hash
        )
        return receipt

    def read_back(self, remote_ref: str) -> ReadBackReceipt:
        return self.rows[remote_ref]


class ContractEncryptor:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def encrypt(self, staged: StagedArtifact, public_key_ref: str) -> bytes:
        self.calls.append(public_key_ref)
        return b"synthetic:ciphertext:" + staged.payload


def archive_artifact(
    *,
    ref: str = "synthetic:artifact/finance",
    version: str = "v1",
    privacy: str = "private",
    payload: bytes = b'{"redacted":true}',
    metadata: dict[str, object] | None = None,
) -> ArchiveArtifact:
    return ArchiveArtifact(ref, version, payload, privacy, True, metadata or {})


def archive_error(callable_obj, *args, **kwargs) -> str:
    with unittest.TestCase().assertRaises(DriveArchiveError) as raised:
        callable_obj(*args, **kwargs)
    return raised.exception.code


RECORDS = (
    LegacyMalRecord(
        "synthetic:mal/txn-001", "transaction", "1.000", "EGP_MAJOR_DECIMAL_TEXT", "EGP", "mal-v1"
    ),
    LegacyMalRecord(
        "synthetic:mal/txn-002", "transaction", "-0.125", "EGP_MAJOR_DECIMAL_TEXT", "EGP", "mal-v1"
    ),
)
EXPECTED = (
    PfosCandidate(
        "synthetic:pfos-candidate/txn-001", "synthetic:mal/txn-001", "transaction", 1000, "EGP", "mal-v1"
    ),
    PfosCandidate(
        "synthetic:pfos-candidate/txn-002", "synthetic:mal/txn-002", "transaction", -125, "EGP", "mal-v1"
    ),
)


class ArchiveContractTests(unittest.TestCase):
    def test_missing_approval_and_wrong_scope_have_zero_archive_effect(self) -> None:
        provider = ContractProvider()
        port = DriveArchivePort(provider, encryptor=ContractEncryptor())

        self.assertEqual(
            archive_error(port.mirror, archive_artifact(), approval=None, idempotency_key="idem:missing"),
            "ARCHIVE_APPROVAL_REQUIRED",
        )
        with self.assertRaises(DriveArchiveError) as raised:
            ArchiveApproval("drive", frozenset({"private"}))
        self.assertEqual(raised.exception.code, "DRIVE_SCOPE_FORBIDDEN")
        self.assertEqual(
            archive_error(
                port.mirror,
                archive_artifact(),
                approval=ArchiveApproval(DRIVE_FILE_SCOPE, frozenset({"public"})),
                idempotency_key="idem:privacy-scope",
            ),
            "ARCHIVE_APPROVAL_SCOPE_MISMATCH",
        )
        with self.assertRaises(DriveArchiveError) as raised:
            DriveArchivePort(ContractProvider(scopes=frozenset({"drive"})))
        self.assertEqual(raised.exception.code, "DRIVE_SCOPE_FORBIDDEN")
        self.assertEqual(provider.uploads, [])

    def test_key_bearing_artifacts_and_key_references_are_rejected(self) -> None:
        provider = ContractProvider()
        port = DriveArchivePort(provider, encryptor=ContractEncryptor())

        self.assertEqual(
            archive_error(
                port.stage,
                archive_artifact(payload=b"-----BEGIN PRIVATE KEY----- synthetic -----END PRIVATE KEY-----"),
            ),
            "SECRET_MATERIAL_FORBIDDEN",
        )
        self.assertEqual(
            archive_error(port.stage, archive_artifact(metadata={"private_key": "synthetic"})),
            "SECRET_MATERIAL_FORBIDDEN",
        )
        staged = port.stage(archive_artifact())
        self.assertEqual(
            archive_error(port.encrypt, staged, "synthetic:private-key-ref"),
            "KEY_MATERIAL_FORBIDDEN",
        )
        self.assertEqual(provider.uploads, [])

    def test_read_back_mismatch_is_not_a_verified_archive(self) -> None:
        for mismatch in ("hash", "artifact_version", "destination_version"):
            with self.subTest(mismatch=mismatch):
                provider = ContractProvider(mismatch=mismatch)
                port = DriveArchivePort(provider, encryptor=ContractEncryptor())
                with self.assertRaises(DriveArchiveError) as raised:
                    port.mirror(
                        archive_artifact(),
                        approval=ARCHIVE_APPROVAL,
                        idempotency_key=f"idem:{mismatch}",
                        public_key_ref="synthetic:public-key-ref-v1",
                    )
                self.assertEqual(raised.exception.code, "READ_BACK_MISMATCH")
                self.assertIsNone(raised.exception.prior_verified_ref)

    def test_same_key_replay_returns_prior_verified_receipt_without_upload(self) -> None:
        provider = ContractProvider()
        port = DriveArchivePort(provider, encryptor=ContractEncryptor())
        first = port.mirror(
            archive_artifact(),
            approval=ARCHIVE_APPROVAL,
            idempotency_key="idem:replay",
            public_key_ref="synthetic:public-key-ref-v1",
        )
        replay = port.mirror(
            archive_artifact(),
            approval=ARCHIVE_APPROVAL,
            idempotency_key="idem:replay",
            public_key_ref="synthetic:public-key-ref-v1",
        )

        self.assertEqual(len(provider.uploads), 1)
        self.assertEqual(replay.remote_ref, first.remote_ref)
        self.assertTrue(replay.idempotent_replay)

    def test_same_key_reuse_for_different_artifact_is_rejected(self) -> None:
        provider = ContractProvider()
        port = DriveArchivePort(provider, encryptor=ContractEncryptor())
        port.mirror(
            archive_artifact(),
            approval=ARCHIVE_APPROVAL,
            idempotency_key="idem:single-use",
            public_key_ref="synthetic:public-key-ref-v1",
        )
        self.assertEqual(
            archive_error(
                port.mirror,
                archive_artifact(ref="synthetic:artifact/other"),
                approval=ARCHIVE_APPROVAL,
                idempotency_key="idem:single-use",
                public_key_ref="synthetic:public-key-ref-v1",
            ),
            "IDEMPOTENCY_KEY_REUSE",
        )
        self.assertEqual(len(provider.uploads), 1)


class MigrationContractTests(unittest.TestCase):
    def test_missing_or_wrong_migration_approval_fails_before_staging(self) -> None:
        with self.assertRaises(MigrationMapperError) as raised:
            stage_synthetic_mal_migration(RECORDS, EXPECTED)
        self.assertEqual(raised.exception.code, "MIGRATION_APPROVAL_REQUIRED")
        with self.assertRaises(MigrationMapperError) as raised:
            SyntheticMigrationApproval(scope="synthetic:other-migration")
        self.assertEqual(raised.exception.code, "MIGRATION_SCOPE_INVALID")

    def test_parity_mismatch_refuses_candidates_and_reports_unexplained_records(self) -> None:
        extra = PfosCandidate(
            "synthetic:pfos-candidate/unexpected",
            "synthetic:mal/unexpected",
            "transaction",
            250,
            "EGP",
            "mal-v1",
        )
        candidates, receipt = stage_synthetic_mal_migration(
            RECORDS, (EXPECTED[0], extra), approval=MIGRATION_APPROVAL
        )

        self.assertEqual(candidates, ())
        self.assertEqual(receipt.status, "REFUSED_PARITY_MISMATCH")
        self.assertFalse(receipt.deterministic_output_parity)
        self.assertEqual(
            receipt.unexplained_records,
            ("synthetic:pfos-candidate/txn-002", "synthetic:pfos-candidate/unexpected"),
        )
        self.assertEqual(receipt.candidate_record_count, 0)

    def test_exact_parity_receipt_is_staged_only_and_preserves_source(self) -> None:
        source_before = RECORDS
        candidates, receipt = stage_synthetic_mal_migration(
            RECORDS, EXPECTED, approval=MIGRATION_APPROVAL
        )

        self.assertEqual(candidates, EXPECTED)
        self.assertEqual(receipt.source_record_count, len(RECORDS))
        self.assertEqual(receipt.candidate_record_count, len(EXPECTED))
        self.assertTrue(receipt.exact_milliunit_conversion)
        self.assertTrue(receipt.deterministic_output_parity)
        self.assertTrue(receipt.staged_only)
        self.assertTrue(receipt.legacy_source_unchanged)
        self.assertFalse(receipt.canonical_writer_changed)
        self.assertFalse(receipt.dual_write_started)
        self.assertFalse(receipt.cutover_performed)
        self.assertEqual(RECORDS, source_before)
        self.assertEqual(receipt.serialize(), receipt.serialize())


if __name__ == "__main__":
    unittest.main()
