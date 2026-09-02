"""Focused offline tests for UPOI task 6.1 Drive archive controls.

Owning contract: UPOI task 6.1; requirements 1.3, 1.4, and 3.3; design sections 6.6 and 9.3.
All provider and encryption behavior is synthetic and injected. These tests do not call Drive,
network, OAuth, secrets, deployment controls, or a live provider.
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


APPROVAL = ArchiveApproval(DRIVE_FILE_SCOPE, frozenset({"public", "private", "restricted"}))


@dataclass
class SyntheticProvider:
    scopes: frozenset[str] = frozenset({DRIVE_FILE_SCOPE})
    corrupt: str | None = None

    def __post_init__(self) -> None:
        self.uploads: list[dict[str, object]] = []
        self.rows: dict[str, ReadBackReceipt] = {}
        self.sequence = 0

    def upload(self, **kwargs: object) -> UploadReceipt:
        self.uploads.append(kwargs)
        key = str(kwargs["idempotency_key"])
        for prior in self.uploads[:-1]:
            if prior["idempotency_key"] == key:
                return UploadReceipt("remote:one", "idem:archive", "destination:v1")
        self.sequence += 1
        remote_ref = f"remote:{self.sequence}"
        receipt = UploadReceipt(remote_ref, key, f"destination:v{self.sequence}")
        content_hash = str(kwargs["content_hash"])
        artifact_version = str(kwargs["artifact_version"])
        if self.corrupt == "hash":
            content_hash = "f" * 64
        if self.corrupt == "artifact_version":
            artifact_version = "wrong-version"
        destination_version = receipt.destination_version
        if self.corrupt == "destination_version":
            destination_version = "wrong-destination"
        self.rows[remote_ref] = ReadBackReceipt(
            remote_ref,
            destination_version,
            artifact_version,
            content_hash,
        )
        return receipt

    def read_back(self, remote_ref: str) -> ReadBackReceipt:
        return self.rows[remote_ref]


class SyntheticEncryptor:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def encrypt(self, staged: StagedArtifact, public_key_ref: str) -> bytes:
        self.calls.append(public_key_ref)
        return b"synthetic-ciphertext:" + staged.payload


def artifact(
    *,
    ref: str = "artifact:finance",
    version: str = "v1",
    privacy: str = "private",
    payload: bytes = b'{"redacted":true}',
    sanitized: bool = True,
    metadata: dict[str, object] | None = None,
) -> ArchiveArtifact:
    return ArchiveArtifact(ref, version, payload, privacy, sanitized, metadata or {})


def error_code(callable_obj, *args, **kwargs) -> str:
    with unittest.TestCase().assertRaises(DriveArchiveError) as raised:
        callable_obj(*args, **kwargs)
    return raised.exception.code


class DriveArchiveTask61Tests(unittest.TestCase):
    def test_constructor_requires_exact_drive_file_scope(self) -> None:
        with self.assertRaises(DriveArchiveError) as raised:
            DriveArchivePort(SyntheticProvider(scopes=frozenset({"drive"})))
        self.assertEqual(raised.exception.code, "DRIVE_SCOPE_FORBIDDEN")

    def test_stage_rejects_unsanitized_and_key_bearing_artifacts(self) -> None:
        port = DriveArchivePort(SyntheticProvider())
        self.assertEqual(error_code(port.stage, artifact(sanitized=False)), "ARTIFACT_NOT_SANITIZED")
        self.assertEqual(
            error_code(port.stage, artifact(payload=b'{"private_key":"synthetic"}')),
            "SECRET_MATERIAL_FORBIDDEN",
        )
        self.assertEqual(
            error_code(port.stage, artifact(metadata={"access_token": "synthetic"})),
            "SECRET_MATERIAL_FORBIDDEN",
        )

    def test_private_artifact_is_encrypted_before_injected_upload(self) -> None:
        provider = SyntheticProvider()
        encryptor = SyntheticEncryptor()
        receipt = DriveArchivePort(provider, encryptor=encryptor).mirror(
            artifact(), approval=APPROVAL, idempotency_key="idem:one", public_key_ref="key-ref:synthetic-v1"
        )
        self.assertTrue(receipt.encrypted)
        self.assertEqual(encryptor.calls, ["key-ref:synthetic-v1"])
        self.assertEqual(provider.uploads[0]["scope"], DRIVE_FILE_SCOPE)
        self.assertEqual(provider.uploads[0]["payload"], b"synthetic-ciphertext:{\"redacted\":true}")
        self.assertNotIn("synthetic-v1", provider.uploads[0]["payload"].decode())

    def test_public_artifact_does_not_require_encryption(self) -> None:
        provider = SyntheticProvider()
        receipt = DriveArchivePort(provider).mirror(
            artifact(privacy="public"), approval=APPROVAL, idempotency_key="idem:public"
        )
        self.assertFalse(receipt.encrypted)
        self.assertEqual(provider.uploads[0]["payload"], b'{"redacted":true}')

    def test_same_key_replay_is_idempotent_and_does_not_upload_again(self) -> None:
        provider = SyntheticProvider()
        port = DriveArchivePort(provider, encryptor=SyntheticEncryptor())
        first = port.mirror(
            artifact(), approval=APPROVAL, idempotency_key="idem:one", public_key_ref="key-ref:synthetic-v1"
        )
        replay = port.mirror(
            artifact(), approval=APPROVAL, idempotency_key="idem:one", public_key_ref="key-ref:synthetic-v1"
        )
        self.assertEqual(len(provider.uploads), 1)
        self.assertEqual(replay.remote_ref, first.remote_ref)
        self.assertTrue(replay.idempotent_replay)

    def test_read_back_requires_hash_and_destination_version(self) -> None:
        for corruption in ("hash", "artifact_version", "destination_version"):
            with self.subTest(corruption=corruption):
                provider = SyntheticProvider(corrupt=corruption)
                port = DriveArchivePort(provider, encryptor=SyntheticEncryptor())
                with self.assertRaises(DriveArchiveError) as raised:
                    port.mirror(
                        artifact(),
                        approval=APPROVAL,
                        idempotency_key=f"idem:{corruption}",
                        public_key_ref="key-ref:synthetic-v1",
                    )
                self.assertEqual(raised.exception.code, "READ_BACK_MISMATCH")
                self.assertEqual(raised.exception.prior_verified_ref, None)

    def test_failed_new_mirror_retains_prior_verified_reference(self) -> None:
        provider = SyntheticProvider()
        port = DriveArchivePort(provider, encryptor=SyntheticEncryptor())
        first = port.mirror(
            artifact(), approval=APPROVAL, idempotency_key="idem:first", public_key_ref="key-ref:synthetic-v1"
        )
        provider.corrupt = "hash"
        with self.assertRaises(DriveArchiveError) as raised:
            port.mirror(
                artifact(version="v2"),
                approval=APPROVAL,
                idempotency_key="idem:second",
                public_key_ref="key-ref:synthetic-v1",
            )
        self.assertEqual(raised.exception.code, "READ_BACK_MISMATCH")
        self.assertEqual(raised.exception.prior_verified_ref, first.remote_ref)

    def test_missing_or_wrong_approval_has_zero_provider_effect(self) -> None:
        provider = SyntheticProvider()
        port = DriveArchivePort(provider, encryptor=SyntheticEncryptor())
        self.assertEqual(error_code(port.mirror, artifact(), approval=None, idempotency_key="idem:none"), "ARCHIVE_APPROVAL_REQUIRED")
        with self.assertRaises(DriveArchiveError) as raised:
            ArchiveApproval("other.scope", frozenset({"private"}))
        self.assertEqual(raised.exception.code, "DRIVE_SCOPE_FORBIDDEN")
        wrong_privacy = ArchiveApproval(DRIVE_FILE_SCOPE, frozenset({"public"}))
        self.assertEqual(
            error_code(port.mirror, artifact(), approval=wrong_privacy, idempotency_key="idem:wrong"),
            "ARCHIVE_APPROVAL_SCOPE_MISMATCH",
        )
        self.assertEqual(provider.uploads, [])


if __name__ == "__main__":
    unittest.main()
