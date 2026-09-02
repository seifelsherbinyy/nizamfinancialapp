"""
NIZAM · injected Drive archive port
Owning contract: UPOI task 6.1; requirements 1.3, 1.4, and 3.3.
Phase: UPOI task 6.1 — offline archive control; no live provider or network path.

This module coordinates sanitization, optional encryption, idempotent upload, and
read-back verification. Provider and encryptor behavior is injected; this module
contains no OAuth client, endpoint, token, key material, or filesystem access.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field, replace
import hashlib
import re
from typing import Any, Protocol


DRIVE_FILE_SCOPE = "drive.file"
PRIVACY_CLASSES = frozenset({"public", "private", "restricted"})
_SECRET_MARKERS = re.compile(
    rb"(?:-----BEGIN[^\r\n]*PRIVATE KEY-----|"
    rb"(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|"
    rb"private[_-]?key|password|secret)[\"']?\s*[:=])",
    re.IGNORECASE,
)
_SECRET_FIELD_NAMES = frozenset(
    {
        "access_token",
        "api_key",
        "client_secret",
        "password",
        "private_key",
        "refresh_token",
        "secret",
    }
)
_HASH_RE = re.compile(r"\A[0-9a-f]{64}\Z")


class DriveArchiveError(ValueError):
    """Fail-closed archive refusal with an optional prior verified mirror."""

    def __init__(self, code: str, *, prior_verified_ref: str | None = None, detail: str = "") -> None:
        self.code = code
        self.prior_verified_ref = prior_verified_ref
        self.detail = detail
        suffix = f": {detail}" if detail else ""
        super().__init__(f"Drive archive refused: {code}{suffix}")


@dataclass(frozen=True, slots=True)
class ArchivePolicy:
    """Archive policy; the only permitted provider scope is drive.file."""

    scope: str = DRIVE_FILE_SCOPE
    encrypted_privacy_classes: frozenset[str] = frozenset({"private", "restricted"})

    def __post_init__(self) -> None:
        if self.scope != DRIVE_FILE_SCOPE:
            raise DriveArchiveError("DRIVE_SCOPE_FORBIDDEN")
        if not self.encrypted_privacy_classes <= PRIVACY_CLASSES:
            raise DriveArchiveError("PRIVACY_CLASS_INVALID")
        if not {"private", "restricted"} <= self.encrypted_privacy_classes:
            raise DriveArchiveError("ENCRYPTION_POLICY_TOO_WEAK")


@dataclass(frozen=True, slots=True)
class ArchiveApproval:
    """Explicit synthetic approval required before an archive effect."""

    scope: str
    permitted_privacy_classes: frozenset[str]

    def __post_init__(self) -> None:
        if self.scope != DRIVE_FILE_SCOPE:
            raise DriveArchiveError("DRIVE_SCOPE_FORBIDDEN")
        if not self.permitted_privacy_classes <= PRIVACY_CLASSES:
            raise DriveArchiveError("PRIVACY_CLASS_INVALID")


@dataclass(frozen=True, slots=True)
class ArchiveArtifact:
    """Caller-provided artifact; stage() proves its sanitized shape before use."""

    artifact_ref: str
    version: str
    payload: bytes
    privacy_class: str
    sanitized: bool
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class StagedArtifact:
    artifact_ref: str
    version: str
    payload: bytes
    privacy_class: str
    content_hash: str


@dataclass(frozen=True, slots=True)
class EncryptedArtifact:
    artifact_ref: str
    version: str
    payload: bytes
    content_hash: str
    source_hash: str
    encrypted: bool


@dataclass(frozen=True, slots=True)
class UploadReceipt:
    remote_ref: str
    idempotency_key: str
    destination_version: str


@dataclass(frozen=True, slots=True)
class ReadBackReceipt:
    remote_ref: str
    destination_version: str
    artifact_version: str
    content_hash: str


@dataclass(frozen=True, slots=True)
class MirrorReceipt:
    idempotency_key: str
    artifact_ref: str
    artifact_version: str
    content_hash: str
    remote_ref: str
    destination_version: str
    encrypted: bool
    idempotent_replay: bool
    prior_verified_ref: str | None


class DriveArchiveProvider(Protocol):
    """Injected provider contract; a live implementation is intentionally absent."""

    @property
    def scopes(self) -> frozenset[str]:
        """Granted scopes for this provider instance."""

    def upload(
        self,
        *,
        payload: bytes,
        content_hash: str,
        artifact_ref: str,
        artifact_version: str,
        idempotency_key: str,
        scope: str,
    ) -> UploadReceipt:
        """Upload encrypted or explicitly public sanitized bytes idempotently."""

    def read_back(self, remote_ref: str) -> ReadBackReceipt:
        """Return destination metadata and hash for verification."""


class ArchiveEncryptor(Protocol):
    """Injected encryption boundary; key material never crosses this module."""

    def encrypt(self, staged: StagedArtifact, public_key_ref: str) -> bytes:
        """Return ciphertext; public_key_ref is a non-secret reference only."""


def _require_text(value: object, code: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise DriveArchiveError(code)
    return value.strip()


def _contains_secret_field(value: object) -> bool:
    if isinstance(value, Mapping):
        for key, nested in value.items():
            if isinstance(key, str) and key.lower().replace("-", "_") in _SECRET_FIELD_NAMES:
                return True
            if _contains_secret_field(nested):
                return True
    elif isinstance(value, (list, tuple, set, frozenset)):
        return any(_contains_secret_field(item) for item in value)
    return False


def _validate_no_secret_material(payload: bytes, metadata: Mapping[str, Any]) -> None:
    if _contains_secret_field(metadata) or _SECRET_MARKERS.search(payload) is not None:
        raise DriveArchiveError("SECRET_MATERIAL_FORBIDDEN")


def _digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


class DriveArchivePort:
    """Safe archive orchestration over an injected, non-network provider."""

    def __init__(
        self,
        provider: DriveArchiveProvider,
        *,
        policy: ArchivePolicy | None = None,
        encryptor: ArchiveEncryptor | None = None,
    ) -> None:
        self._provider = provider
        self._policy = policy or ArchivePolicy()
        self._encryptor = encryptor
        scopes = getattr(provider, "scopes", frozenset())
        if frozenset(scopes) != frozenset({DRIVE_FILE_SCOPE}):
            raise DriveArchiveError("DRIVE_SCOPE_FORBIDDEN")
        self._verified_by_key: dict[str, MirrorReceipt] = {}
        self._verified_by_artifact: dict[str, MirrorReceipt] = {}

    def _prior_ref(self, artifact_ref: str) -> str | None:
        prior = self._verified_by_artifact.get(artifact_ref)
        return prior.remote_ref if prior is not None else None

    def stage(self, artifact: ArchiveArtifact) -> StagedArtifact:
        """Accept only explicitly sanitized, secret-free, content-addressed bytes."""

        if not isinstance(artifact, ArchiveArtifact):
            raise DriveArchiveError("ARTIFACT_INVALID")
        if artifact.sanitized is not True:
            raise DriveArchiveError("ARTIFACT_NOT_SANITIZED")
        artifact_ref = _require_text(artifact.artifact_ref, "ARTIFACT_REF_INVALID")
        version = _require_text(artifact.version, "ARTIFACT_VERSION_INVALID")
        if not isinstance(artifact.payload, bytes):
            raise DriveArchiveError("ARTIFACT_PAYLOAD_INVALID")
        if artifact.privacy_class not in PRIVACY_CLASSES:
            raise DriveArchiveError("PRIVACY_CLASS_INVALID")
        if not isinstance(artifact.metadata, Mapping):
            raise DriveArchiveError("ARTIFACT_METADATA_INVALID")
        _validate_no_secret_material(artifact.payload, artifact.metadata)
        return StagedArtifact(
            artifact_ref=artifact_ref,
            version=version,
            payload=bytes(artifact.payload),
            privacy_class=artifact.privacy_class,
            content_hash=_digest(artifact.payload),
        )

    def encrypt(self, staged: StagedArtifact, public_key_ref: str) -> EncryptedArtifact:
        """Encrypt private material through an injected encryptor without storing keys."""

        key_ref = _require_text(public_key_ref, "PUBLIC_KEY_REF_INVALID")
        lowered = key_ref.lower()
        if any(marker in lowered for marker in ("private", "secret", "token", "-----begin")):
            raise DriveArchiveError("KEY_MATERIAL_FORBIDDEN")
        if self._encryptor is None:
            raise DriveArchiveError("ENCRYPTOR_UNAVAILABLE")
        try:
            ciphertext = self._encryptor.encrypt(staged, key_ref)
        except DriveArchiveError:
            raise
        except Exception as error:  # provider/encryptor details must not escape the boundary
            raise DriveArchiveError("ENCRYPTION_FAILED") from error
        if not isinstance(ciphertext, bytes):
            raise DriveArchiveError("ENCRYPTED_PAYLOAD_INVALID")
        return EncryptedArtifact(
            artifact_ref=staged.artifact_ref,
            version=staged.version,
            payload=ciphertext,
            content_hash=_digest(ciphertext),
            source_hash=staged.content_hash,
            encrypted=True,
        )

    def upload(self, encrypted: EncryptedArtifact, *, idempotency_key: str) -> UploadReceipt:
        """Upload prepared bytes through the injected provider under drive.file."""

        if not isinstance(encrypted, EncryptedArtifact):
            raise DriveArchiveError("ENCRYPTED_ARTIFACT_INVALID")
        key = _require_text(idempotency_key, "IDEMPOTENCY_KEY_INVALID")
        if not isinstance(encrypted.payload, bytes) or _HASH_RE.fullmatch(encrypted.content_hash) is None:
            raise DriveArchiveError("ENCRYPTED_ARTIFACT_INVALID")
        try:
            receipt = self._provider.upload(
                payload=encrypted.payload,
                content_hash=encrypted.content_hash,
                artifact_ref=encrypted.artifact_ref,
                artifact_version=encrypted.version,
                idempotency_key=key,
                scope=self._policy.scope,
            )
        except DriveArchiveError:
            raise
        except Exception as error:
            raise DriveArchiveError("ARCHIVE_PROVIDER_FAILED") from error
        if not isinstance(receipt, UploadReceipt) or receipt.idempotency_key != key:
            raise DriveArchiveError("IDEMPOTENCY_RECEIPT_INVALID")
        return receipt

    def read_back(self, receipt: UploadReceipt) -> ReadBackReceipt:
        """Read destination metadata only; callers must still compare it to expectations."""

        if not isinstance(receipt, UploadReceipt) or not receipt.remote_ref.strip():
            raise DriveArchiveError("UPLOAD_RECEIPT_INVALID")
        try:
            read_back = self._provider.read_back(receipt.remote_ref)
        except DriveArchiveError:
            raise
        except Exception as error:
            raise DriveArchiveError("ARCHIVE_PROVIDER_FAILED") from error
        if not isinstance(read_back, ReadBackReceipt):
            raise DriveArchiveError("READ_BACK_INVALID")
        return read_back

    def mirror(
        self,
        artifact: ArchiveArtifact,
        *,
        approval: ArchiveApproval | None,
        idempotency_key: str,
        public_key_ref: str | None = None,
    ) -> MirrorReceipt:
        """Stage, optionally encrypt, upload once, and require hash/version read-back."""

        staged = self.stage(artifact)
        key = _require_text(idempotency_key, "IDEMPOTENCY_KEY_INVALID")
        if approval is None:
            raise DriveArchiveError(
                "ARCHIVE_APPROVAL_REQUIRED",
                prior_verified_ref=self._prior_ref(staged.artifact_ref),
            )
        if approval.scope != self._policy.scope or staged.privacy_class not in approval.permitted_privacy_classes:
            raise DriveArchiveError(
                "ARCHIVE_APPROVAL_SCOPE_MISMATCH",
                prior_verified_ref=self._prior_ref(staged.artifact_ref),
            )

        prior = self._verified_by_artifact.get(staged.artifact_ref)
        existing = self._verified_by_key.get(key)
        if existing is not None:
            if existing.artifact_ref != staged.artifact_ref or existing.artifact_version != staged.version:
                raise DriveArchiveError("IDEMPOTENCY_KEY_REUSE", prior_verified_ref=prior.remote_ref if prior else None)
            return replace(existing, idempotent_replay=True)

        if staged.privacy_class in self._policy.encrypted_privacy_classes:
            if public_key_ref is None:
                raise DriveArchiveError("PUBLIC_KEY_REF_REQUIRED", prior_verified_ref=prior.remote_ref if prior else None)
            prepared = self.encrypt(staged, public_key_ref)
        else:
            prepared = EncryptedArtifact(
                artifact_ref=staged.artifact_ref,
                version=staged.version,
                payload=staged.payload,
                content_hash=staged.content_hash,
                source_hash=staged.content_hash,
                encrypted=False,
            )

        try:
            upload = self.upload(prepared, idempotency_key=key)
            read_back = self.read_back(upload)
        except DriveArchiveError as error:
            if error.prior_verified_ref is None and prior is not None:
                raise DriveArchiveError(
                    error.code,
                    prior_verified_ref=prior.remote_ref,
                    detail=error.detail,
                ) from error
            raise
        except Exception as error:
            raise DriveArchiveError("ARCHIVE_PROVIDER_FAILED", prior_verified_ref=prior.remote_ref if prior else None) from error

        mismatch: str | None = None
        if read_back.remote_ref != upload.remote_ref:
            mismatch = "remote_ref"
        elif not isinstance(read_back.content_hash, str) or _HASH_RE.fullmatch(read_back.content_hash) is None or read_back.content_hash != prepared.content_hash:
            mismatch = "hash"
        elif read_back.artifact_version != prepared.version:
            mismatch = "artifact_version"
        elif not upload.destination_version or read_back.destination_version != upload.destination_version:
            mismatch = "destination_version"
        if mismatch is not None:
            raise DriveArchiveError(
                "READ_BACK_MISMATCH",
                prior_verified_ref=prior.remote_ref if prior else None,
                detail=mismatch,
            )

        receipt = MirrorReceipt(
            idempotency_key=key,
            artifact_ref=prepared.artifact_ref,
            artifact_version=prepared.version,
            content_hash=prepared.content_hash,
            remote_ref=upload.remote_ref,
            destination_version=read_back.destination_version,
            encrypted=prepared.encrypted,
            idempotent_replay=False,
            prior_verified_ref=prior.remote_ref if prior else None,
        )
        self._verified_by_key[key] = receipt
        self._verified_by_artifact[prepared.artifact_ref] = receipt
        return receipt


__all__ = [
    "ArchiveApproval",
    "ArchiveArtifact",
    "ArchiveEncryptor",
    "ArchivePolicy",
    "DriveArchiveError",
    "DriveArchivePort",
    "DriveArchiveProvider",
    "DRIVE_FILE_SCOPE",
    "EncryptedArtifact",
    "MirrorReceipt",
    "ReadBackReceipt",
    "StagedArtifact",
    "UploadReceipt",
]
