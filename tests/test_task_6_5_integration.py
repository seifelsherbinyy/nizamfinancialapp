"""Task 6.5 synthetic integration rehearsal.

Owning contract: UPOI task 6.5; requirements 1.3, 2.3, and 3.3.
Phase: UPOI task 6.5 — offline archive/read-back/restore/parity integration only.

All providers, encryption, queue controls, restore controls, and migration inputs are
in-memory synthetic fakes. These tests never use a live provider, network, secret,
real ledger, deployment control, or canonical writer.
"""

from __future__ import annotations

from dataclasses import dataclass
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
    PfosCandidate,
    SyntheticMigrationApproval,
    stage_synthetic_mal_migration,
)
from src.server.rollback_rehearsal import (
    FailedCandidate,
    KnownGoodReference,
    ReclaimableWork,
    RestoreReceipt,
    SyntheticEncryptedSnapshot,
    VerificationReport,
    rehearse_rollback_restore,
)


APPROVAL = ArchiveApproval(DRIVE_FILE_SCOPE, frozenset({"public", "private", "restricted"}))
MIGRATION_APPROVAL = SyntheticMigrationApproval()


@dataclass
class Provider:
    corrupt: bool = False

    def __post_init__(self) -> None:
        self.rows: dict[str, ReadBackReceipt] = {}
        self.last_upload: UploadReceipt | None = None
        self.sequence = 0

    @property
    def scopes(self) -> frozenset[str]:
        return frozenset({DRIVE_FILE_SCOPE})

    def upload(self, **kwargs: object) -> UploadReceipt:
        self.sequence += 1
        receipt = UploadReceipt(
            f"synthetic:archive/upload-{self.sequence}",
            str(kwargs["idempotency_key"]),
            "synthetic:destination/v1",
        )
        content_hash = "f" * 64 if self.corrupt else str(kwargs["content_hash"])
        self.rows[receipt.remote_ref] = ReadBackReceipt(
            receipt.remote_ref,
            receipt.destination_version,
            str(kwargs["artifact_version"]),
            content_hash,
        )
        self.last_upload = receipt
        return receipt

    def read_back(self, remote_ref: str) -> ReadBackReceipt:
        return self.rows[remote_ref]


class Encryptor:
    def encrypt(self, staged: StagedArtifact, public_key_ref: str) -> bytes:
        return b"synthetic:ciphertext:" + staged.payload


class RehearsalControls:
    def __init__(self, work: tuple[ReclaimableWork, ...]) -> None:
        self.events: list[str] = []
        self.work = work
        self.evidence: list[object] = []
        self.verification = VerificationReport(True, True, True, True, True)

    def halt(self) -> None:
        self.events.append("halt")

    def fence(self) -> None:
        self.events.append("fence")

    def inspect(self) -> dict[str, int]:
        self.events.append("inspect")
        return {"queued": 1, "running": len(self.work), "done": 0, "failed": 0}

    def capture(self, evidence: object) -> None:
        self.events.append("evidence")
        self.evidence.append(evidence)

    def restore(self, snapshot: SyntheticEncryptedSnapshot, known_good: KnownGoodReference, candidates: tuple[FailedCandidate, ...]) -> RestoreReceipt:
        self.events.append("restore")
        return RestoreReceipt(known_good.snapshot_ref, known_good.snapshot_version, known_good.binary_ref, True, True)

    def reclaim(self, work: tuple[ReclaimableWork, ...]) -> tuple[ReclaimableWork, ...]:
        self.events.append("reclaim")
        return work

    def run(self, known_good: KnownGoodReference) -> VerificationReport:
        self.events.append("verify")
        return self.verification


def snapshot_artifact() -> ArchiveArtifact:
    return ArchiveArtifact(
        "synthetic:artifact/known-good",
        "snapshot-v1",
        b'{"snapshot":"redacted"}',
        "private",
        True,
        {},
    )


class Task65IntegrationTests(unittest.TestCase):
    def test_archive_readback_mismatch_then_synthetic_restore(self) -> None:
        provider = Provider()
        archive = DriveArchivePort(provider, encryptor=Encryptor())
        first = archive.mirror(
            snapshot_artifact(),
            approval=APPROVAL,
            idempotency_key="synthetic:idempotency/archive-v1",
            public_key_ref="synthetic:public-key-ref",
        )
        self.assertTrue(first.encrypted)
        self.assertIsNotNone(provider.last_upload)
        known_good_upload = provider.last_upload
        self.assertEqual(
            archive.read_back(known_good_upload).content_hash,
            first.content_hash,
        )

        provider.corrupt = True
        with self.assertRaises(DriveArchiveError) as raised:
            archive.mirror(
                ArchiveArtifact(
                    "synthetic:artifact/known-good",
                    "snapshot-v2",
                    b'{"snapshot":"redacted-v2"}',
                    "private",
                    True,
                    {},
                ),
                approval=APPROVAL,
                idempotency_key="synthetic:idempotency/archive-v2",
                public_key_ref="synthetic:public-key-ref",
            )
        self.assertEqual(raised.exception.code, "READ_BACK_MISMATCH")
        self.assertEqual(raised.exception.prior_verified_ref, first.remote_ref)
        self.assertEqual(
            archive.read_back(known_good_upload).content_hash,
            first.content_hash,
        )

        provider.corrupt = False
        upload = known_good_upload
        self.assertIsNotNone(upload)
        staged = archive.stage(snapshot_artifact())
        encrypted = archive.encrypt(staged, "synthetic:public-key-ref")
        snapshot = SyntheticEncryptedSnapshot(
            "synthetic:snapshot/known-good",
            "snapshot-v1",
            "synthetic:binary/v1",
            encrypted,
            upload,
        )
        work = (ReclaimableWork("synthetic:queue/work-1", "synthetic:idempotency/work-1"),)
        controls = RehearsalControls(work)
        receipt = rehearse_rollback_restore(
            archive=archive,
            snapshot=snapshot,
            known_good=KnownGoodReference(snapshot.snapshot_ref, snapshot.snapshot_version, snapshot.binary_ref),
            intake=controls,
            workers=controls,
            queue=controls,
            evidence=controls,
            restorer=controls,
            verifier=controls,
            failed_candidates=(FailedCandidate("synthetic:pfos-candidate/failed-1", "READ_BACK_MISMATCH"),),
            reclaimable_work=work,
            correlation_refs=("synthetic:correlation/rollback-1",),
        )
        self.assertEqual(receipt.status, "VERIFIED")
        self.assertFalse(receipt.resumption_authorized)
        self.assertEqual(controls.events[:4], ["halt", "fence", "inspect", "evidence"])
        self.assertLess(controls.events.index("restore"), controls.events.index("reclaim"))
        self.assertLess(controls.events.index("reclaim"), controls.events.index("verify"))
        self.assertEqual(len(controls.evidence), 2)

    def test_pfos_mal_parity_refusal_is_staged_only(self) -> None:
        record = LegacyMalRecord(
            "synthetic:mal/txn-001",
            "transaction",
            "1.000",
            "EGP_MAJOR_DECIMAL_TEXT",
            "EGP",
            "mal-synthetic-v1",
        )
        expected = PfosCandidate(
            "synthetic:pfos-candidate/txn-001",
            record.record_ref,
            record.kind,
            1001,
            record.currency,
            record.source_version,
        )
        candidates, receipt = stage_synthetic_mal_migration(
            (record,),
            (expected,),
            approval=MIGRATION_APPROVAL,
        )
        self.assertEqual(candidates, ())
        self.assertEqual(receipt.status, "REFUSED_PARITY_MISMATCH")
        self.assertFalse(receipt.deterministic_output_parity)
        self.assertEqual(receipt.candidate_record_count, 0)
        self.assertTrue(receipt.staged_only)
        self.assertTrue(receipt.legacy_source_unchanged)
        self.assertFalse(receipt.canonical_writer_changed)
        self.assertFalse(receipt.dual_write_started)
        self.assertFalse(receipt.cutover_performed)


if __name__ == "__main__":
    unittest.main()
