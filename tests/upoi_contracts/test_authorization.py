"""Focused offline tests for UPOI task 2.2 grant and human-gate admission.

Owning contract: UPOI task 2.2; requirements 1.1 and 1.2; design sections 8.2, 14.2, and 22.
All values are synthetic. Admission has no dispatch, persistence, provider, secret, or live-work
capability and every blocked result must report zero external effects.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from upoi_contracts import (
    ActionPlan,
    ActionRisk,
    AuthorizationCode,
    AuthorizationStatus,
    AuthorityClass,
    Gate,
    GateKind,
    GateState,
    Grant,
    ProfilePolicy,
    authorize_plan,
    plan_operator_turn,
    OperatorTurn,
)
from upoi_contracts.models import EvidenceLabel, PrivacyClass, ConfidenceBand, ProvenanceRecord

UTC = timezone.utc
NOW = datetime(2026, 1, 2, 4, 4, 5, tzinfo=UTC)
OBSERVED = NOW - timedelta(hours=1)
HASH = "a" * 64


def provenance() -> ProvenanceRecord:
    return ProvenanceRecord(
        source_ref="synthetic/approval",
        source_version="v1",
        content_hash=HASH,
        observed_at=OBSERVED,
        evidence_label=EvidenceLabel.FACT,
        authority_class=AuthorityClass.EVIDENCE_ONLY,
        privacy_class=PrivacyClass.PRIVATE,
        confidence=ConfidenceBand.HIGH,
    )


def runtime_plan():
    decision = plan_operator_turn(
        OperatorTurn(
            turn_ref="turn:runtime",
            intent="invoke_bounded_runtime",
            requested_action="invoke",
            target_authority=AuthorityClass.EXECUTION_RUNTIME,
            scope=("runtime/synthetic-tool",),
            idempotency_key="idem:runtime",
        )
    )
    assert decision.plan is not None
    return decision.plan


def finance_plan():
    decision = plan_operator_turn(
        OperatorTurn(
            turn_ref="turn:finance",
            intent="append_financial_command",
            requested_action="append",
            target_authority=AuthorityClass.DETERMINISTIC_DOMAIN,
            scope=("finance/write/synthetic",),
            idempotency_key="idem:finance",
        )
    )
    assert decision.plan is not None
    return decision.plan


class AuthorizationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.runtime_profile = ProfilePolicy(
            "profile:runtime",
            AuthorityClass.EXECUTION_RUNTIME,
            ("runtime/", "runtime:"),
        )
        self.finance_profile = ProfilePolicy(
            "profile:finance",
            AuthorityClass.DETERMINISTIC_DOMAIN,
            ("finance/", "finance:"),
        )

    def grant(self, plan, *, profile="profile:runtime", scope=None, expires=None, issued=OBSERVED, gate=None):
        return Grant(
            grant_id=f"grant:{plan.plan_id}",
            issuer=AuthorityClass.GOVERNANCE,
            recipient=plan.target_authority,
            scope=scope or tuple((*plan.scope, *plan.required_grant_scopes)),
            issued_at=issued,
            expires_at=expires or NOW + timedelta(hours=1),
            provenance=provenance(),
            idempotency_key=plan.idempotency_key,
            gate_id=gate,
            profile_id=profile,
        )

    def approved_gate(self, plan) -> Gate:
        assert plan.human_gate is not None
        return Gate(
            gate_id=plan.human_gate,
            kind=GateKind.HUMAN,
            scope=plan.scope,
            requested_at=OBSERVED,
            state=GateState.APPROVED,
            approver=AuthorityClass.OWNER,
            decided_at=NOW - timedelta(minutes=10),
            decision_ref="decision:synthetic-owner",
        )

    def assert_blocked(self, decision, code: AuthorizationCode) -> None:
        self.assertEqual(decision.status, AuthorizationStatus.BLOCKED)
        self.assertEqual(decision.code, code)
        self.assertIsNone(decision.authorized_plan)
        self.assertEqual(decision.external_effect_count, 0)
        self.assertEqual(decision.message, "This plan is blocked pending explicit owner authorization.")
        self.assertTrue(decision.next_owner_action)

    def test_current_exact_profile_scope_and_grant_are_admitted(self) -> None:
        plan = runtime_plan()
        decision = authorize_plan(
            plan,
            self.runtime_profile,
            (self.grant(plan),),
            (),
            NOW,
        )

        self.assertEqual(decision.status, AuthorizationStatus.ACCEPTED)
        self.assertIsNotNone(decision.authorized_plan)
        self.assertEqual(decision.authorized_plan.profile_id, "profile:runtime")

    def test_absent_grant_is_blocked_without_inference(self) -> None:
        self.assert_blocked(
            authorize_plan(runtime_plan(), self.runtime_profile, (), (), NOW),
            AuthorizationCode.MISSING_GRANT,
        )

    def test_expired_grant_is_stale_and_profile_mismatch_is_not_rescued(self) -> None:
        plan = runtime_plan()
        expired = self.grant(plan, expires=NOW)
        self.assert_blocked(
            authorize_plan(plan, self.runtime_profile, (expired,), (), NOW),
            AuthorizationCode.STALE_GRANT,
        )
        wrong_profile = self.grant(plan, profile="profile:other")
        self.assert_blocked(
            authorize_plan(plan, self.runtime_profile, (wrong_profile,), (), NOW),
            AuthorizationCode.GRANT_PROFILE_MISMATCH,
        )

    def test_scope_mismatch_and_over_broad_grants_are_rejected(self) -> None:
        plan = runtime_plan()
        wrong_scope = self.grant(plan, scope=("runtime/other-tool", "runtime:invoke"))
        self.assert_blocked(
            authorize_plan(plan, self.runtime_profile, (wrong_scope,), (), NOW),
            AuthorizationCode.GRANT_SCOPE_MISMATCH,
        )
        broad_scope = self.grant(plan, scope=("runtime/synthetic-tool", "runtime:invoke", "runtime/other-tool"))
        self.assert_blocked(
            authorize_plan(plan, self.runtime_profile, (broad_scope,), (), NOW),
            AuthorizationCode.GRANT_OVER_BROAD,
        )

    def test_human_gate_requires_explicit_owner_approval_and_exact_scope(self) -> None:
        plan = finance_plan()
        grant = self.grant(
            plan,
            profile="profile:finance",
            gate=plan.human_gate,
        )
        missing_gate = authorize_plan(plan, self.finance_profile, (grant,), (), NOW)
        self.assert_blocked(missing_gate, AuthorizationCode.MISSING_HUMAN_GATE)

        pending = Gate(
            gate_id=plan.human_gate or "",
            kind=GateKind.HUMAN,
            scope=plan.scope,
            requested_at=OBSERVED,
            state=GateState.PENDING,
            next_owner_action="Owner reviews the synthetic finance command.",
        )
        self.assert_blocked(
            authorize_plan(plan, self.finance_profile, (grant,), (pending,), NOW),
            AuthorizationCode.HUMAN_GATE_NOT_APPROVED,
        )

        approved = authorize_plan(
            plan,
            self.finance_profile,
            (grant,),
            (self.approved_gate(plan),),
            NOW,
        )
        self.assertEqual(approved.status, AuthorizationStatus.ACCEPTED)
        assert approved.authorized_plan is not None
        self.assertEqual(approved.authorized_plan.gate.state, GateState.APPROVED)

    def test_approved_gate_with_wrong_scope_does_not_authorize(self) -> None:
        plan = finance_plan()
        grant = self.grant(plan, profile="profile:finance", gate=plan.human_gate)
        gate = Gate(
            gate_id=plan.human_gate or "",
            kind=GateKind.HUMAN,
            scope=("finance/write/other",),
            requested_at=OBSERVED,
            state=GateState.APPROVED,
            approver=AuthorityClass.OWNER,
            decided_at=NOW - timedelta(minutes=10),
            decision_ref="decision:synthetic-owner",
        )
        self.assert_blocked(
            authorize_plan(plan, self.finance_profile, (grant,), (gate,), NOW),
            AuthorizationCode.HUMAN_GATE_SCOPE_MISMATCH,
        )


if __name__ == "__main__":
    unittest.main()
