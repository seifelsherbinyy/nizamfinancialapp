"""Unit tests for the immutable UPOI contract models.

Owning contract: UPOI task 1.1; requirements 1.1, 1.3, 1.4; design sections 6, 7.1, and 7.4.
All records are synthetic and local. These tests do not call providers, access secrets, or perform
live work.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from upoi_contracts import (
    ActionPlan,
    ActionRisk,
    AuthorityClass,
    BaselineRef,
    BlockerKind,
    CheckDefinition,
    ConfidenceBand,
    ContractValidationError,
    EvidenceContract,
    EvidenceLabel,
    ExecutionOutcome,
    ExecutionReceipt,
    Gate,
    GateKind,
    GateState,
    GovernanceTrace,
    Grant,
    LabeledFinding,
    ObjectiveDefinition,
    ObjectiveEvaluation,
    ObjectiveState,
    PrivacyClass,
    ProvenanceRecord,
    TypedBlocker,
    VerificationReceipt,
)

UTC = timezone.utc
OBSERVED_AT = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
HASH = "a" * 64
OTHER_HASH = "b" * 64


def provenance() -> ProvenanceRecord:
    return ProvenanceRecord(
        source_ref="synthetic/source",
        source_version="v1",
        content_hash=HASH,
        observed_at=OBSERVED_AT,
        evidence_label=EvidenceLabel.FACT,
        authority_class=AuthorityClass.EVIDENCE_ONLY,
        privacy_class=PrivacyClass.PRIVATE,
        confidence=ConfidenceBand.HIGH,
    )


def check(name: str) -> CheckDefinition:
    return CheckDefinition(name, f"synthetic check {name}")


def trace() -> GovernanceTrace:
    return GovernanceTrace(("contract:upoi-1.1",), ("requirement:1.1",))


class AuthorityAndProvenanceTests(unittest.TestCase):
    def test_authority_vocabulary_contains_exactly_the_eight_design_classes(self) -> None:
        self.assertEqual(
            {item.value for item in AuthorityClass},
            {
                "owner",
                "governance",
                "deterministic-domain",
                "execution-runtime",
                "operator-interface",
                "context",
                "archive",
                "evidence-only",
            },
        )

    def test_complete_provenance_is_accepted_and_immutable(self) -> None:
        record = provenance()
        with self.assertRaises(Exception):
            record.source_ref = "changed"  # type: ignore[misc]

    def test_malformed_hashes_and_non_utc_timestamps_fail_closed(self) -> None:
        cases = [
            {"content_hash": "A" * 64},
            {"content_hash": "a" * 63},
            {"observed_at": datetime(2026, 1, 2, 3, 4, 5)},
            {"observed_at": OBSERVED_AT.astimezone(timezone(timedelta(hours=1)))},
            {"source_version": ""},
        ]
        for override in cases:
            values = {
                "source_ref": "synthetic/source",
                "source_version": "v1",
                "content_hash": HASH,
                "observed_at": OBSERVED_AT,
                "evidence_label": EvidenceLabel.FACT,
                "authority_class": AuthorityClass.EVIDENCE_ONLY,
                "privacy_class": PrivacyClass.PRIVATE,
                "confidence": ConfidenceBand.HIGH,
            }
            values.update(override)
            with self.subTest(override=override), self.assertRaises(ContractValidationError):
                ProvenanceRecord(**values)


class ObjectiveAndBlockerTests(unittest.TestCase):
    def test_objective_definition_and_evaluation_require_typed_evidence(self) -> None:
        definition = ObjectiveDefinition(
            id=1,
            name="Synthetic objective",
            validation_question="Does the synthetic control hold?",
            owner=AuthorityClass.GOVERNANCE,
            evidence_contract=EvidenceContract("contract:synthetic", ("requirement:1.1",)),
            positive_checks=(check("positive"),),
            negative_checks=(check("negative"),),
            regression_checks=(check("regression"),),
        )
        baseline = BaselineRef("baseline/synthetic", HASH, "v1")
        finding = LabeledFinding(EvidenceLabel.VERIFIED_IMPLEMENTATION, "verified fixture", (provenance(),))
        evaluation = ObjectiveEvaluation(
            objective_id=definition.id,
            state=ObjectiveState.VERIFIED,
            baseline_ref=baseline,
            evidence_refs=("evidence/synthetic",),
            findings=(finding,),
            evaluated_at=OBSERVED_AT,
        )
        self.assertEqual(evaluation.baseline_ref.content_hash, HASH)

    def test_blocked_objective_requires_a_typed_next_action(self) -> None:
        baseline = BaselineRef("baseline/synthetic", HASH, "v1")
        blocker = TypedBlocker(
            BlockerKind.HUMAN_GATE,
            "OWNER_APPROVAL_REQUIRED",
            "The external effect is human gated.",
            "Owner records approval for the named scope.",
            AuthorityClass.GOVERNANCE,
            OBSERVED_AT,
        )
        evaluation = ObjectiveEvaluation(
            objective_id=1,
            state=ObjectiveState.BLOCKED_HUMAN,
            baseline_ref=baseline,
            evidence_refs=(),
            findings=(),
            evaluated_at=OBSERVED_AT,
            blockers=(blocker,),
        )
        self.assertEqual(evaluation.blockers[0].kind, BlockerKind.HUMAN_GATE)
        with self.assertRaises(ContractValidationError):
            TypedBlocker(
                BlockerKind.DEPENDENCY,
                "MISSING_DEPENDENCY",
                "A dependency is unavailable.",
                "",
                AuthorityClass.GOVERNANCE,
                OBSERVED_AT,
            )


class GovernanceAndReceiptTests(unittest.TestCase):
    def test_unsupported_authority_transfer_is_rejected(self) -> None:
        with self.assertRaises(ContractValidationError):
            Grant(
                grant_id="grant-forged",
                issuer=AuthorityClass.OWNER,
                recipient=AuthorityClass.EXECUTION_RUNTIME,
                scope=("synthetic/action",),
                issued_at=OBSERVED_AT,
                expires_at=OBSERVED_AT + timedelta(hours=1),
                provenance=provenance(),
                idempotency_key="idem-forged",
            )

    def test_supported_grant_and_pending_gate_are_explicit(self) -> None:
        grant = Grant(
            grant_id="grant-runtime",
            issuer=AuthorityClass.GOVERNANCE,
            recipient=AuthorityClass.EXECUTION_RUNTIME,
            scope=("synthetic/action",),
            issued_at=OBSERVED_AT,
            expires_at=OBSERVED_AT + timedelta(hours=1),
            provenance=provenance(),
            idempotency_key="idem-runtime",
            gate_id="gate-owner",
        )
        gate = Gate(
            gate_id="gate-owner",
            kind=GateKind.HUMAN,
            scope=("synthetic/action",),
            requested_at=OBSERVED_AT,
            state=GateState.PENDING,
            next_owner_action="Owner reviews the synthetic action scope.",
        )
        self.assertEqual(grant.recipient, AuthorityClass.EXECUTION_RUNTIME)
        self.assertEqual(gate.state, GateState.PENDING)

    def test_human_approval_cannot_be_issued_by_runtime(self) -> None:
        with self.assertRaises(ContractValidationError):
            Gate(
                gate_id="gate-invalid",
                kind=GateKind.HUMAN,
                scope=("synthetic/action",),
                requested_at=OBSERVED_AT,
                state=GateState.APPROVED,
                approver=AuthorityClass.EXECUTION_RUNTIME,
                decided_at=OBSERVED_AT,
                decision_ref="decision/synthetic",
            )

    def test_consequential_plan_requires_rollback_and_human_gate_when_applicable(self) -> None:
        with self.assertRaises(ContractValidationError):
            ActionPlan(
                plan_id="plan-no-rollback",
                intent="synthetic reversible action",
                target_authority=AuthorityClass.EXECUTION_RUNTIME,
                risk=ActionRisk.EXTERNAL_REVERSIBLE,
                idempotency_key="idem-plan",
                required_grants=(),
                human_gate=None,
                preconditions=(check("pre"),),
                postconditions=(check("post"),),
                rollback_ref=None,
                governance_trace=trace(),
            )
        with self.assertRaises(ContractValidationError):
            ActionPlan(
                plan_id="plan-no-gate",
                intent="synthetic irreversible action",
                target_authority=AuthorityClass.EXECUTION_RUNTIME,
                risk=ActionRisk.IRREVERSIBLE,
                idempotency_key="idem-plan",
                required_grants=(),
                human_gate=None,
                preconditions=(check("pre"),),
                postconditions=(check("post"),),
                rollback_ref="rollback/synthetic",
                governance_trace=trace(),
            )

    def test_receipts_preserve_traceability_and_hash_integrity(self) -> None:
        execution = ExecutionReceipt(
            execution_ref="execution/synthetic",
            plan_id="plan-synthetic",
            idempotency_key="idem-synthetic",
            outcome=ExecutionOutcome.SUCCEEDED,
            effect_refs=("effect/synthetic",),
            audit_ref="audit/synthetic",
            executed_at=OBSERVED_AT,
            governance_trace=trace(),
        )
        verification = VerificationReceipt(
            execution_ref=execution.execution_ref,
            observed_state_hash=HASH,
            expected_state_hash=HASH,
            matched=True,
            verified_at=OBSERVED_AT,
        )
        self.assertEqual(verification.execution_ref, execution.execution_ref)
        with self.assertRaises(ContractValidationError):
            VerificationReceipt("execution/synthetic", HASH, OTHER_HASH, True, OBSERVED_AT)


if __name__ == "__main__":
    unittest.main()
