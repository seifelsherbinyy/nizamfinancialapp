"""
Task 6.4 focused offline rollback/restore rehearsal tests.

Owning contract: UPOI task 6.4; requirements 1.3, 2.3, and 3.3; design §19.
Phase: UPOI task 6.4 — synthetic encrypted snapshots only.

All dependencies are in-memory fakes. These tests do not deploy, restore a real
store, call providers, use network/secrets, touch deployment controls, or resume
intake/workers.
"""

from __future__ import annotations

from dataclasses import dataclass
import unittest

from src.server.drive_archive import (
    ArchiveArtifact,
    DriveArchivePort,
    DRIVE_FILE_SCOPE,
    EncryptedArtifact,
    ReadBackReceipt,
    StagedArtifact,
    UploadReceipt,
)
from src.server.rollback_rehearsal import (
    FailedCandidate,
    KnownGoodReference,
    ReclaimableWork,
    RestoreReceipt,
    RollbackRehearsalError,
    SyntheticEncryptedSnapshot,
    VerificationReport,
    rehearse_rollback_restore,
)


@dataclass
class Provider:
    corrupt: bool = False

    def __post_init__(self) -> None:
        self.row: ReadBackReceipt | None = None

    @property
    def scopes(self) -> frozenset[str]:
        return frozenset({DRIVE_FILE_SCOPE})

    def upload(self, **kwargs: object) -> UploadReceipt:
        receipt = UploadReceipt("synthetic:archive/known-good", str(kwargs["idempotency_key"]), "destination:v1")
        content_hash = "f" * 64 if self.corrupt else str(kwargs["content_hash"])
        self.row = ReadBackReceipt(receipt.remote_ref, receipt.destination_version, str(kwargs["artifact_version"]), content_hash)
        return receipt

    def read_back(self, remote_ref: str) -> ReadBackReceipt:
        assert self.row is not None
        return self.row


class Encryptor:
    def encrypt(self, staged: StagedArtifact, public_key_ref: str) -> bytes:
        return b"synthetic:ciphertext:" + staged.payload


class Controls:
    def __init__(self, queue_items: tuple[ReclaimableWork, ...]) -> None:
        self.events: list[str] = []
        self.queue_items = queue_items
        self.evidence: list[object] = []
        self.reclaimed: tuple[ReclaimableWork, ...] = ()
        self.restored_candidates: tuple[FailedCandidate, ...] = ()
        self.verification = VerificationReport(True, True, True, True, True)

    def halt(self) -> None:
        self.events.append("halt")

    def fence(self) -> None:
        self.events.append("fence")

    def inspect(self) -> dict[str, int]:
        self.events.append("inspect")
        return {"queued": 1, "running": len(self.queue_items), "done": 0, "failed": 1}

    def reclaim(self, work: tuple[ReclaimableWork, ...]) -> tuple[ReclaimableWork, ...]:
        self.events.append("reclaim")
        self.reclaimed = work
        return work

    def capture(self, evidence: object) -> None:
        self.events.append("evidence")
        self.evidence.append(evidence)

    def restore(self, snapshot: SyntheticEncryptedSnapshot, known_good: KnownGoodReference, candidates: tuple[FailedCandidate, ...]) -> RestoreReceipt:
        self.events.append("restore")
        self.restored_candidates = candidates
        return RestoreReceipt(known_good.snapshot_ref, known_good.snapshot_version, known_good.binary_ref, True, True)

    def run(self, known_good: KnownGoodReference) -> VerificationReport:
        self.events.append("verify")
        return self.verification


class RollbackRehearsalTests(unittest.TestCase):
    def make_snapshot(self, *, corrupt: bool = False) -> tuple[DriveArchivePort, SyntheticEncryptedSnapshot]:
        provider = Provider(corrupt=corrupt)
        archive = DriveArchivePort(provider, encryptor=Encryptor())
        staged = archive.stage(
            ArchiveArtifact("synthetic:artifact/snapshot", "snapshot-v1", b"redacted-ciphertext-input", "private", True, {})
        )
        encrypted_payload = archive.encrypt(staged, "synthetic:public-key-ref")
        upload = archive.upload(encrypted_payload, idempotency_key="synthetic:idempotency/archive")
        snapshot = SyntheticEncryptedSnapshot(
            "synthetic:snapshot/known-good",
            "snapshot-v1",
            "synthetic:binary/v1",
            encrypted_payload,
            upload,
        )
        return archive, snapshot

    def test_halt_fence_restore_reclaim_and_verification_are_ordered_and_redacted(self) -> None:
        archive, snapshot = self.make_snapshot()
        work = (ReclaimableWork("synthetic:queue/work-1", "synthetic:idempotency/work-1"),)
        candidate = FailedCandidate("synthetic:pfos-candidate/failed-1", "PARITY_MISMATCH")
        controls = Controls(work)
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
            failed_candidates=(candidate,),
            reclaimable_work=work,
            correlation_refs=("synthetic:correlation/rollback-1",),
        )

        self.assertEqual(receipt.status, "VERIFIED")
        self.assertEqual(receipt.reclaimed_idempotency_keys, (work[0].idempotency_key,))
        self.assertEqual(receipt.failed_candidate_refs, (candidate.candidate_ref,))
        self.assertEqual(controls.restored_candidates, (candidate,))
        self.assertFalse(receipt.resumption_authorized)
        self.assertEqual(controls.events[:4], ["halt", "fence", "inspect", "evidence"])
        self.assertLess(controls.events.index("restore"), controls.events.index("reclaim"))
        self.assertLess(controls.events.index("reclaim"), controls.events.index("verify"))
        self.assertEqual(len(controls.evidence), 2)
        self.assertNotIn("redacted-ciphertext-input", controls.evidence[0].serialize())

    def test_archive_read_back_mismatch_refuses_before_restore_or_reclaim(self) -> None:
        archive, snapshot = self.make_snapshot(corrupt=True)
        work = (ReclaimableWork("synthetic:queue/work-1", "synthetic:idempotency/work-1"),)
        controls = Controls(work)
        with self.assertRaises(RollbackRehearsalError) as raised:
            rehearse_rollback_restore(
                archive=archive,
                snapshot=snapshot,
                known_good=KnownGoodReference(snapshot.snapshot_ref, snapshot.snapshot_version, snapshot.binary_ref),
                intake=controls,
                workers=controls,
                queue=controls,
                evidence=controls,
                restorer=controls,
                verifier=controls,
                reclaimable_work=work,
            )
        self.assertEqual(raised.exception.code, "ARCHIVE_READ_BACK_MISMATCH")
        self.assertNotIn("restore", controls.events)
        self.assertNotIn("reclaim", controls.events)
        self.assertNotIn("verify", controls.events)

    def test_known_good_binary_mismatch_is_rejected_before_halt(self) -> None:
        archive, snapshot = self.make_snapshot()
        controls = Controls(())
        with self.assertRaises(RollbackRehearsalError) as raised:
            rehearse_rollback_restore(
                archive=archive,
                snapshot=snapshot,
                known_good=KnownGoodReference(snapshot.snapshot_ref, snapshot.snapshot_version, "synthetic:binary/v2"),
                intake=controls,
                workers=controls,
                queue=controls,
                evidence=controls,
                restorer=controls,
                verifier=controls,
            )
        self.assertEqual(raised.exception.code, "KNOWN_GOOD_BINARY_MISMATCH")
        self.assertEqual(controls.events, [])

    def test_failed_verification_is_refused_without_authorizing_resumption(self) -> None:
        archive, snapshot = self.make_snapshot()
        controls = Controls(())
        controls.verification = VerificationReport(True, True, False, True, True)
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
        )
        self.assertEqual(receipt.status, "REFUSED_VERIFICATION")
        self.assertFalse(receipt.verification.passed)
        self.assertFalse(receipt.resumption_authorized)

    def test_reclaim_requires_original_synthetic_idempotency_key(self) -> None:
        with self.assertRaises(RollbackRehearsalError) as raised:
            ReclaimableWork("synthetic:queue/work-1", "synthetic:retry/new-key")
        self.assertEqual(raised.exception.code, "ORIGINAL_KEY_REQUIRED")


if __name__ == "__main__":
    unittest.main()
