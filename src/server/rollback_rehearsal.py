"""
NIZAM · offline synthetic rollback/restore rehearsal
Owning contract: UPOI task 6.4; requirements 1.3, 2.3, and 3.3; design §19.
Phase: UPOI task 6.4 — synthetic encrypted snapshots only; no deployment, provider,
network, secret, real-store, or deployment-control behavior.

The rehearsal composes injected archive, queue, worker, restore, verification, and
redacted-evidence ports. It never opens a store, decrypts bytes, resumes intake, or
creates a new idempotency key. A receipt is evidence of a rehearsal, not permission
for live promotion.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
import hashlib
import json
import re
from typing import Protocol

from .drive_archive import (
    DriveArchiveError,
    DriveArchivePort,
    EncryptedArtifact,
    ReadBackReceipt,
    UploadReceipt,
)

_SHA256 = re.compile(r"\A[0-9a-f]{64}\Z")
_SYNTHETIC_REF = re.compile(r"\Asynthetic:[A-Za-z0-9._/-]+\Z")
_SAFE_KEY = re.compile(r"\Asynthetic:idempotency/[A-Za-z0-9._/-]+\Z")
_QUEUE_STATES = frozenset({"queued", "running", "done", "failed"})


class RollbackRehearsalError(ValueError):
    """Fail-closed refusal; no later rehearsal phase is attempted."""

    def __init__(self, code: str, field: str = "rehearsal") -> None:
        self.code = code
        self.field = field
        super().__init__(f"synthetic rollback rehearsal refused {field}: {code}")


@dataclass(frozen=True, slots=True)
class SyntheticEncryptedSnapshot:
    """Ciphertext metadata only; plaintext and key material are not representable."""

    snapshot_ref: str
    snapshot_version: str
    binary_ref: str
    artifact: EncryptedArtifact
    upload_receipt: UploadReceipt

    def __post_init__(self) -> None:
        for name in ("snapshot_ref", "binary_ref"):
            value = getattr(self, name)
            if not isinstance(value, str) or _SYNTHETIC_REF.fullmatch(value) is None:
                raise RollbackRehearsalError("SYNTHETIC_REFERENCE_REQUIRED", name)
        if not isinstance(self.snapshot_version, str) or not self.snapshot_version.strip():
            raise RollbackRehearsalError("SNAPSHOT_VERSION_INVALID", "snapshot_version")
        if not isinstance(self.artifact, EncryptedArtifact) or not self.artifact.encrypted:
            raise RollbackRehearsalError("ENCRYPTED_SNAPSHOT_REQUIRED", "artifact")
        if not isinstance(self.upload_receipt, UploadReceipt):
            raise RollbackRehearsalError("UPLOAD_RECEIPT_REQUIRED", "upload_receipt")
        if self.upload_receipt.idempotency_key.strip() == "":
            raise RollbackRehearsalError("UPLOAD_RECEIPT_INVALID", "upload_receipt")


@dataclass(frozen=True, slots=True)
class KnownGoodReference:
    snapshot_ref: str
    snapshot_version: str
    binary_ref: str

    def __post_init__(self) -> None:
        for name in ("snapshot_ref", "binary_ref"):
            if _SYNTHETIC_REF.fullmatch(getattr(self, name)) is None:
                raise RollbackRehearsalError("SYNTHETIC_REFERENCE_REQUIRED", name)
        if not self.snapshot_version.strip():
            raise RollbackRehearsalError("SNAPSHOT_VERSION_INVALID", "snapshot_version")


@dataclass(frozen=True, slots=True)
class ReclaimableWork:
    queued_ref: str
    idempotency_key: str
    state: str = "running"
    eligible: bool = True

    def __post_init__(self) -> None:
        if _SYNTHETIC_REF.fullmatch(self.queued_ref) is None:
            raise RollbackRehearsalError("SYNTHETIC_REFERENCE_REQUIRED", "queued_ref")
        if _SAFE_KEY.fullmatch(self.idempotency_key) is None:
            raise RollbackRehearsalError("ORIGINAL_KEY_REQUIRED", "idempotency_key")
        if self.state not in _QUEUE_STATES:
            raise RollbackRehearsalError("QUEUE_STATE_INVALID", "state")
        if self.state != "running" or not self.eligible:
            raise RollbackRehearsalError("WORK_NOT_RECLAIMABLE", "work")


@dataclass(frozen=True, slots=True)
class FailedCandidate:
    candidate_ref: str
    reason_code: str

    def __post_init__(self) -> None:
        if _SYNTHETIC_REF.fullmatch(self.candidate_ref) is None:
            raise RollbackRehearsalError("SYNTHETIC_REFERENCE_REQUIRED", "candidate_ref")
        if not self.reason_code or any(character.isspace() for character in self.reason_code):
            raise RollbackRehearsalError("REASON_CODE_INVALID", "reason_code")


@dataclass(frozen=True, slots=True)
class RestoreReceipt:
    snapshot_ref: str
    snapshot_version: str
    binary_ref: str
    restored: bool
    failed_candidates_retained: bool


@dataclass(frozen=True, slots=True)
class VerificationReport:
    positive_passed: bool
    negative_passed: bool
    regression_passed: bool
    integrity_passed: bool
    destination_read_back_passed: bool

    @property
    def passed(self) -> bool:
        return all(asdict(self).values())


@dataclass(frozen=True, slots=True)
class RollbackEvidence:
    """Only hashes, versions, codes, counts, and synthetic references are capturable."""

    phase: str
    snapshot_hash: str
    binary_ref: str
    queue_counts: Mapping[str, int]
    failed_candidate_refs: tuple[str, ...]
    correlation_refs: tuple[str, ...]
    outcome_code: str

    def __post_init__(self) -> None:
        if self.phase not in {"HALTED_FENCED", "RESTORED_VERIFIED", "REFUSED"}:
            raise RollbackRehearsalError("EVIDENCE_PHASE_INVALID", "phase")
        if _SHA256.fullmatch(self.snapshot_hash) is None:
            raise RollbackRehearsalError("EVIDENCE_HASH_INVALID", "snapshot_hash")
        if _SYNTHETIC_REF.fullmatch(self.binary_ref) is None:
            raise RollbackRehearsalError("SYNTHETIC_REFERENCE_REQUIRED", "binary_ref")
        if not isinstance(self.queue_counts, Mapping) or any(
            not isinstance(key, str) or key not in _QUEUE_STATES or not isinstance(value, int) or value < 0
            for key, value in self.queue_counts.items()
        ):
            raise RollbackRehearsalError("QUEUE_COUNTS_INVALID", "queue_counts")
        if any(_SYNTHETIC_REF.fullmatch(ref) is None for ref in self.failed_candidate_refs + self.correlation_refs):
            raise RollbackRehearsalError("EVIDENCE_REFERENCE_INVALID", "evidence")
        if not self.outcome_code or any(character.isspace() for character in self.outcome_code):
            raise RollbackRehearsalError("OUTCOME_CODE_INVALID", "outcome_code")

    def serialize(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, separators=(",", ":"), sort_keys=True)


@dataclass(frozen=True, slots=True)
class RollbackRehearsalReceipt:
    status: str
    snapshot_ref: str
    snapshot_hash: str
    binary_ref: str
    failed_candidate_refs: tuple[str, ...]
    reclaimed_work_refs: tuple[str, ...]
    reclaimed_idempotency_keys: tuple[str, ...]
    verification: VerificationReport
    evidence_count: int
    resumption_authorized: bool = False

    def __post_init__(self) -> None:
        if self.status not in {"VERIFIED", "REFUSED_VERIFICATION"}:
            raise RollbackRehearsalError("RECEIPT_STATUS_INVALID", "status")
        if _SHA256.fullmatch(self.snapshot_hash) is None:
            raise RollbackRehearsalError("RECEIPT_HASH_INVALID", "snapshot_hash")
        if self.evidence_count < 1 or self.resumption_authorized:
            raise RollbackRehearsalError("RECEIPT_SAFETY_INVARIANT_FAILED", "receipt")

    def serialize(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, separators=(",", ":"), sort_keys=True)


class IntakeControl(Protocol):
    def halt(self) -> None: ...


class WorkerFence(Protocol):
    def fence(self) -> None: ...


class QueueControl(Protocol):
    def inspect(self) -> Mapping[str, int]: ...

    def reclaim(self, work: tuple[ReclaimableWork, ...]) -> tuple[ReclaimableWork, ...]: ...


class EvidenceSink(Protocol):
    def capture(self, evidence: RollbackEvidence) -> None: ...


class SnapshotRestorer(Protocol):
    def restore(
        self,
        snapshot: SyntheticEncryptedSnapshot,
        known_good: KnownGoodReference,
        failed_candidates: tuple[FailedCandidate, ...],
    ) -> RestoreReceipt: ...


class VerificationRunner(Protocol):
    def run(self, known_good: KnownGoodReference) -> VerificationReport: ...


def _hash_snapshot(snapshot: SyntheticEncryptedSnapshot) -> str:
    payload = {
        "snapshot_ref": snapshot.snapshot_ref,
        "snapshot_version": snapshot.snapshot_version,
        "binary_ref": snapshot.binary_ref,
        "content_hash": snapshot.artifact.content_hash,
        "upload_ref": snapshot.upload_receipt.remote_ref,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _capture(
    sink: EvidenceSink,
    *,
    phase: str,
    snapshot: SyntheticEncryptedSnapshot,
    queue_counts: Mapping[str, int],
    failed_candidates: tuple[FailedCandidate, ...],
    correlation_refs: tuple[str, ...],
    outcome_code: str,
) -> None:
    sink.capture(
        RollbackEvidence(
            phase=phase,
            snapshot_hash=_hash_snapshot(snapshot),
            binary_ref=snapshot.binary_ref,
            queue_counts=dict(queue_counts),
            failed_candidate_refs=tuple(candidate.candidate_ref for candidate in failed_candidates),
            correlation_refs=correlation_refs,
            outcome_code=outcome_code,
        )
    )


def rehearse_rollback_restore(
    *,
    archive: DriveArchivePort,
    snapshot: SyntheticEncryptedSnapshot,
    known_good: KnownGoodReference,
    intake: IntakeControl,
    workers: WorkerFence,
    queue: QueueControl,
    evidence: EvidenceSink,
    restorer: SnapshotRestorer,
    verifier: VerificationRunner,
    failed_candidates: Sequence[FailedCandidate] = (),
    reclaimable_work: Sequence[ReclaimableWork] = (),
    correlation_refs: Sequence[str] = (),
) -> RollbackRehearsalReceipt:
    """Run halt-first synthetic restore and verification without resumption authority."""

    candidates = tuple(failed_candidates)
    work = tuple(reclaimable_work)
    correlations = tuple(correlation_refs)
    if any(_SYNTHETIC_REF.fullmatch(ref) is None for ref in correlations):
        raise RollbackRehearsalError("EVIDENCE_REFERENCE_INVALID", "correlation_refs")
    if snapshot.snapshot_ref != known_good.snapshot_ref or snapshot.snapshot_version != known_good.snapshot_version:
        raise RollbackRehearsalError("KNOWN_GOOD_SNAPSHOT_MISMATCH", "known_good")
    if snapshot.binary_ref != known_good.binary_ref:
        raise RollbackRehearsalError("KNOWN_GOOD_BINARY_MISMATCH", "known_good")

    intake.halt()
    workers.fence()
    before_counts = dict(queue.inspect())
    _capture(
        evidence,
        phase="HALTED_FENCED",
        snapshot=snapshot,
        queue_counts=before_counts,
        failed_candidates=candidates,
        correlation_refs=correlations,
        outcome_code="ROLLBACK_HALTED_FENCED",
    )

    try:
        read_back: ReadBackReceipt = archive.read_back(snapshot.upload_receipt)
        if (
            read_back.remote_ref != snapshot.upload_receipt.remote_ref
            or read_back.artifact_version != snapshot.artifact.version
            or read_back.content_hash != snapshot.artifact.content_hash
            or read_back.destination_version != snapshot.upload_receipt.destination_version
        ):
            raise RollbackRehearsalError("ARCHIVE_READ_BACK_MISMATCH", "snapshot")

        restored = restorer.restore(snapshot, known_good, candidates)
        if (
            not restored.restored
            or restored.snapshot_ref != known_good.snapshot_ref
            or restored.snapshot_version != known_good.snapshot_version
            or restored.binary_ref != known_good.binary_ref
            or not restored.failed_candidates_retained
        ):
            raise RollbackRehearsalError("RESTORE_INTEGRITY_FAILED", "restore")

        reclaimed = queue.reclaim(work)
        if tuple(item.queued_ref for item in reclaimed) != tuple(item.queued_ref for item in work):
            raise RollbackRehearsalError("RECLAIM_SET_MISMATCH", "queue")
        if tuple(item.idempotency_key for item in reclaimed) != tuple(item.idempotency_key for item in work):
            raise RollbackRehearsalError("ORIGINAL_KEY_NOT_PRESERVED", "queue")

        verification = verifier.run(known_good)
        status = "VERIFIED" if verification.passed else "REFUSED_VERIFICATION"
        _capture(
            evidence,
            phase="RESTORED_VERIFIED" if verification.passed else "REFUSED",
            snapshot=snapshot,
            queue_counts=dict(queue.inspect()),
            failed_candidates=candidates,
            correlation_refs=correlations,
            outcome_code="ROLLBACK_VERIFIED" if verification.passed else "ROLLBACK_VERIFICATION_FAILED",
        )
        return RollbackRehearsalReceipt(
            status=status,
            snapshot_ref=snapshot.snapshot_ref,
            snapshot_hash=_hash_snapshot(snapshot),
            binary_ref=snapshot.binary_ref,
            failed_candidate_refs=tuple(candidate.candidate_ref for candidate in candidates),
            reclaimed_work_refs=tuple(item.queued_ref for item in reclaimed),
            reclaimed_idempotency_keys=tuple(item.idempotency_key for item in reclaimed),
            verification=verification,
            evidence_count=2,
        )
    except (DriveArchiveError, RollbackRehearsalError):
        raise


__all__ = [
    "EvidenceSink",
    "FailedCandidate",
    "IntakeControl",
    "KnownGoodReference",
    "QueueControl",
    "ReclaimableWork",
    "RestoreReceipt",
    "RollbackEvidence",
    "RollbackRehearsalError",
    "RollbackRehearsalReceipt",
    "SnapshotRestorer",
    "SyntheticEncryptedSnapshot",
    "VerificationReport",
    "VerificationRunner",
    "WorkerFence",
    "rehearse_rollback_restore",
]
