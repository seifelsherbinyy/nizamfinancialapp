"""Property checks for UPOI task 2.4 bounded effect execution.

Owning contract: UPOI task 2.4; phase: offline governance verification. This module is
synthetic-only: it uses no providers, network, secrets, deployment, persistence, or commits.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import NamedTuple
import unittest

from hypothesis import given, settings, strategies as st
from hypothesis.strategies import composite

from upoi_contracts import (
    AUTHORITY_RULES,
    ActionPlan,
    ActionRisk,
    AuditEventKind,
    AuditReceiptStore,
    AuthorizedPlan,
    AuthorityClass,
    BoundedDispatcher,
    DispatchEffect,
    DispatchError,
    ExecutionOutcome,
    ExecutionReceipt,
    Gate,
    GateKind,
    GateState,
    Grant,
    GovernanceTrace,
    ProfilePolicy,
    VerificationReceipt,
    authorize_plan,
    plan_operator_turn,
    OperatorTurn,
)
from upoi_contracts.models import ConfidenceBand, EvidenceLabel, PrivacyClass, ProvenanceRecord


UTC = timezone.utc
NOW = datetime(2026, 1, 2, 4, 4, 5, tzinfo=UTC)
OBSERVED = NOW - timedelta(hours=1)
HASH = "a" * 64
TRACE = GovernanceTrace(("contract:upoi-governance",), ("requirement:1.1", "requirement:1.2", "requirement:1.3"))
CONSEQUENTIAL_RULES = tuple(rule for rule in AUTHORITY_RULES.rules if rule.risk is not ActionRisk.READ_ONLY)


class BoundedCase(NamedTuple):
    rule_index: int
    authority: AuthorityClass
    grant_state: str
    gate_state: str
    idempotency_state: str
    audit_seeded: bool
    verification_state: str
    alternate_rollback: bool
    nonce: int


def provenance() -> ProvenanceRecord:
    return ProvenanceRecord(
        source_ref="synthetic/task-2-4-approval",
        source_version="v1",
        content_hash=HASH,
        observed_at=OBSERVED,
        evidence_label=EvidenceLabel.FACT,
        authority_class=AuthorityClass.EVIDENCE_ONLY,
        privacy_class=PrivacyClass.PRIVATE,
        confidence=ConfidenceBand.HIGH,
    )


@composite
def bounded_cases(draw) -> BoundedCase:
    rule_index = draw(st.integers(min_value=0, max_value=len(CONSEQUENTIAL_RULES) - 1))
    rule = CONSEQUENTIAL_RULES[rule_index]
    gate_state = (
        draw(st.sampled_from(("valid", "missing", "pending", "rejected", "expired", "stale")))
        if rule.human_gate
        else "not_applicable"
    )
    return BoundedCase(
        rule_index=rule_index,
        authority=draw(st.sampled_from(tuple(AuthorityClass))),
        grant_state=draw(st.sampled_from(("valid", "missing", "stale"))),
        gate_state=gate_state,
        idempotency_state=draw(st.sampled_from(("valid", "mismatch"))),
        audit_seeded=draw(st.booleans()),
        verification_state=draw(st.sampled_from(("matched", "mismatched", "unknown"))),
        alternate_rollback=draw(st.booleans()),
        nonce=draw(st.integers(min_value=0, max_value=100_000)),
    )


def _seed_audit(audit: AuditReceiptStore) -> None:
    execution = ExecutionReceipt(
        execution_ref="execution:seed",
        plan_id="plan:seed",
        idempotency_key="idem:seed",
        outcome=ExecutionOutcome.SUCCEEDED,
        effect_refs=(),
        audit_ref="audit:1",
        executed_at=NOW,
        governance_trace=TRACE,
    )
    audit.append_execution(execution, recorded_at=NOW)
    verification = VerificationReceipt(
        execution_ref=execution.execution_ref,
        observed_state_hash=HASH,
        expected_state_hash=HASH,
        matched=True,
        verified_at=NOW,
        governance_trace=TRACE,
    )
    audit.append_verification(
        verification,
        plan_id=execution.plan_id,
        idempotency_key=execution.idempotency_key,
        governance_trace=TRACE,
        recorded_at=NOW,
    )


class SyntheticTarget:
    def __init__(self, verification_state: str) -> None:
        self.verification_state = verification_state
        self.calls = 0
        self.effect_count = 0
        self.observe_calls = 0
        self.expected_state: object | None = None

    def execute(self, plan: ActionPlan) -> DispatchEffect:
        self.calls += 1
        effect_refs = (f"effect:{plan.idempotency_key}",)
        self.expected_state = {"plan_id": plan.plan_id, "effect": effect_refs[0]}
        self.effect_count += len(effect_refs)
        return DispatchEffect(effect_refs, self.expected_state)

    def observe(self, plan: ActionPlan, receipt: ExecutionReceipt) -> object:
        self.observe_calls += 1
        if self.verification_state == "unknown":
            raise RuntimeError("synthetic observer unavailable")
        if self.verification_state == "mismatched":
            return {"plan_id": plan.plan_id, "effect": "synthetic-different-state"}
        return self.expected_state


def _plan_for(case: BoundedCase) -> tuple[object, ActionPlan | None]:
    rule = CONSEQUENTIAL_RULES[case.rule_index]
    scope_prefix = rule.allowed_scope_prefixes[0]
    decision = plan_operator_turn(
        OperatorTurn(
            turn_ref=f"turn:task-2-4:{case.nonce}",
            intent=rule.intent,
            requested_action=rule.requested_action,
            target_authority=case.authority,
            scope=(f"{scope_prefix}synthetic-{case.nonce}",),
            idempotency_key=f"idem:task-2-4:{case.nonce}",
        )
    )
    if decision.plan is None:
        return decision, None
    plan = decision.plan
    if case.alternate_rollback:
        plan = plan.__class__(
            plan_id=plan.plan_id,
            intent=plan.intent,
            target_authority=plan.target_authority,
            risk=plan.risk,
            idempotency_key=plan.idempotency_key,
            required_grants=plan.required_grants,
            human_gate=plan.human_gate,
            preconditions=plan.preconditions,
            postconditions=plan.postconditions,
            rollback_ref=f"rollback:synthetic-alternate-{case.nonce}",
            governance_trace=plan.governance_trace,
            required_grant_scopes=plan.required_grant_scopes,
            scope=plan.scope,
        )
    return decision, plan


def _grant(plan: ActionPlan, case: BoundedCase) -> Grant:
    issued_at = OBSERVED
    expires_at = NOW + timedelta(hours=1)
    if case.grant_state == "stale":
        expires_at = NOW
    idempotency_key = plan.idempotency_key if case.idempotency_state == "valid" else "idem:wrong-key"
    return Grant(
        grant_id=f"grant:{plan.plan_id}",
        issuer=AuthorityClass.GOVERNANCE,
        recipient=plan.target_authority,
        scope=tuple((*plan.scope, *plan.required_grant_scopes)),
        issued_at=issued_at,
        expires_at=expires_at,
        provenance=provenance(),
        idempotency_key=idempotency_key,
        gate_id=plan.human_gate,
        profile_id=f"profile:{plan.target_authority.value}",
    )


def _gate(plan: ActionPlan, case: BoundedCase) -> Gate:
    assert plan.human_gate is not None
    if case.gate_state == "valid":
        return Gate(
            gate_id=plan.human_gate,
            kind=GateKind.HUMAN,
            scope=plan.scope,
            requested_at=OBSERVED,
            state=GateState.APPROVED,
            approver=AuthorityClass.OWNER,
            decided_at=NOW - timedelta(minutes=10),
            decision_ref="decision:synthetic-task-2-4",
        )
    if case.gate_state == "pending":
        return Gate(
            gate_id=plan.human_gate,
            kind=GateKind.HUMAN,
            scope=plan.scope,
            requested_at=OBSERVED,
            state=GateState.PENDING,
            next_owner_action="Owner reviews the synthetic bounded effect.",
        )
    if case.gate_state in {"rejected", "expired"}:
        return Gate(
            gate_id=plan.human_gate,
            kind=GateKind.HUMAN,
            scope=plan.scope,
            requested_at=OBSERVED,
            state=GateState.REJECTED if case.gate_state == "rejected" else GateState.EXPIRED,
            next_owner_action="Owner records a current synthetic approval.",
        )
    return Gate(
        gate_id=plan.human_gate,
        kind=GateKind.HUMAN,
        scope=plan.scope,
        requested_at=NOW + timedelta(minutes=1),
        state=GateState.APPROVED,
        approver=AuthorityClass.OWNER,
        decided_at=NOW + timedelta(minutes=1),
        decision_ref="decision:synthetic-stale-task-2-4",
    )


def _profile(plan: ActionPlan) -> ProfilePolicy:
    family = plan.scope[0].split("/", 1)[0]
    return ProfilePolicy(
        profile_id=f"profile:{plan.target_authority.value}",
        recipient=plan.target_authority,
        allowed_scope_prefixes=(f"{family}/", f"{family}:")
    )


class BoundedEffectPropertyTests(unittest.TestCase):
    # **Validates: Requirements 1.1, 1.2, 1.3**
    @settings(max_examples=120, deadline=None)
    @given(bounded_cases())
    def test_property_bounded_effect_execution(self, case: BoundedCase) -> None:
        """Missing/stale approval cannot reach the target; accepted effects close the chain."""
        rule = CONSEQUENTIAL_RULES[case.rule_index]
        decision, plan = _plan_for(case)

        # An authority/risk pair not covered by the exact governance rule is no-plan/no-effect.
        if case.authority is not rule.target_authority:
            self.assertIsNone(plan)
            self.assertEqual(decision.external_effect_count, 0)
            return

        assert plan is not None
        grants = () if case.grant_state == "missing" else (_grant(plan, case),)
        gates = () if plan.human_gate is None or case.gate_state == "missing" else (_gate(plan, case),)
        authorization = authorize_plan(plan, _profile(plan), grants, gates, NOW)
        approval_is_current = (
            case.grant_state == "valid"
            and case.idempotency_state == "valid"
            and (plan.human_gate is None or case.gate_state == "valid")
        )

        if not approval_is_current:
            self.assertEqual(authorization.external_effect_count, 0)
            self.assertIsNone(authorization.authorized_plan)
            self.assertEqual(authorization.status.value, "BLOCKED")
            return

        authorized = authorization.authorized_plan
        self.assertIsNotNone(authorized)
        assert authorized is not None
        audit = AuditReceiptStore()
        if case.audit_seeded:
            _seed_audit(audit)
        target = SyntheticTarget(case.verification_state)
        dispatcher = BoundedDispatcher(target, audit, clock=lambda: NOW)

        if case.verification_state == "unknown":
            with self.assertRaises(DispatchError) as raised:
                dispatcher.dispatch(authorized)
            self.assertEqual(raised.exception.code.value, "VERIFICATION_UNKNOWN")
            self.assertEqual(target.effect_count, 1)
            self.assertEqual(target.calls, 1)
            self.assertEqual(
                [receipt.kind for receipt in audit.receipts[-2:]],
                [AuditEventKind.EXECUTION, AuditEventKind.VERIFICATION_UNKNOWN],
            )
            with self.assertRaises(DispatchError) as replay:
                dispatcher.dispatch(authorized)
            self.assertEqual(replay.exception.code.value, "SAFE_REPLAY_BLOCKED")
            self.assertEqual(target.calls, 1)
            self.assertTrue(audit.verify_chain())
            return

        result = dispatcher.dispatch(authorized)
        self.assertEqual(result.execution.outcome, ExecutionOutcome.SUCCEEDED)
        self.assertEqual(target.effect_count, 1)
        self.assertEqual(target.calls, 1)
        self.assertEqual(target.observe_calls, 1)
        self.assertIsNotNone(result.verification)
        verification = result.verification
        assert verification is not None
        self.assertEqual(verification.execution_ref, result.execution.execution_ref)
        self.assertEqual(verification.governance_trace, result.execution.governance_trace)
        self.assertEqual(verification.matched, case.verification_state == "matched")

        # The final two events form the execution -> verification receipt chain.
        self.assertEqual(
            [receipt.kind for receipt in audit.receipts[-2:]],
            [AuditEventKind.EXECUTION, AuditEventKind.VERIFICATION],
        )
        execution_event, verification_event = audit.receipts[-2:]
        self.assertEqual(execution_event.receipt_ref, result.execution.audit_ref)
        self.assertEqual(verification_event.receipt_ref, result.execution.execution_ref)
        self.assertEqual(execution_event.plan_id, plan.plan_id)
        self.assertEqual(execution_event.idempotency_key, plan.idempotency_key)
        self.assertEqual(execution_event.governance_trace, result.execution.governance_trace)
        self.assertEqual(verification_event.governance_trace, result.execution.governance_trace)
        self.assertTrue(audit.verify_chain())

        replay = dispatcher.dispatch(authorized)
        self.assertTrue(replay.replayed)
        self.assertEqual(replay.execution.execution_ref, result.execution.execution_ref)
        self.assertEqual(target.calls, 1)
        self.assertEqual(audit.receipts[-1].kind, AuditEventKind.SAFE_REPLAY)
        self.assertTrue(audit.verify_chain())
