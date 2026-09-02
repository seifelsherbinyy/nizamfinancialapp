"""Focused offline tests for UPOI task 2.3 dispatch and receipt controls.

Owning contract: UPOI task 2.3; requirement 1.3; design sections 6.1, 7.4,
9.1, and 19.3. All target behavior is synthetic and injected. These tests
never call a provider, network, secret, deployment, or financial writer.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
import unittest

from upoi_contracts import (
    ActionPlan,
    AuditEventKind,
    AuditReceiptStore,
    AuthorizedPlan,
    AuthorityClass,
    BoundedDispatcher,
    DispatchCode,
    DispatchEffect,
    DispatchError,
    ExecutionOutcome,
    Grant,
    ProfilePolicy,
    authorize_plan,
    plan_operator_turn,
    OperatorTurn,
)
from upoi_contracts.models import ConfidenceBand, EvidenceLabel, PrivacyClass, ProvenanceRecord


UTC = timezone.utc
NOW = datetime(2026, 1, 2, 4, 4, 5, tzinfo=UTC)
HASH = "a" * 64


def provenance() -> ProvenanceRecord:
    return ProvenanceRecord(
        source_ref="synthetic/dispatch-approval",
        source_version="v1",
        content_hash=HASH,
        observed_at=NOW,
        evidence_label=EvidenceLabel.FACT,
        authority_class=AuthorityClass.EVIDENCE_ONLY,
        privacy_class=PrivacyClass.PRIVATE,
        confidence=ConfidenceBand.HIGH,
    )


def authorized_runtime(scope: tuple[str, ...] = ("runtime/synthetic-tool",)) -> AuthorizedPlan:
    decision = plan_operator_turn(
        OperatorTurn(
            turn_ref="turn:dispatch",
            intent="invoke_bounded_runtime",
            requested_action="invoke",
            target_authority=AuthorityClass.EXECUTION_RUNTIME,
            scope=scope,
            idempotency_key="idem:dispatch",
        )
    )
    assert decision.plan is not None
    plan = decision.plan
    grant = Grant(
        grant_id="grant:dispatch",
        issuer=AuthorityClass.GOVERNANCE,
        recipient=plan.target_authority,
        scope=tuple((*plan.scope, *plan.required_grant_scopes)),
        issued_at=NOW,
        expires_at=datetime(2026, 1, 2, 5, 4, 5, tzinfo=UTC),
        provenance=provenance(),
        idempotency_key=plan.idempotency_key,
        profile_id="profile:runtime",
    )
    admitted = authorize_plan(
        plan,
        ProfilePolicy("profile:runtime", AuthorityClass.EXECUTION_RUNTIME, ("runtime/", "runtime:")),
        (grant,),
        (),
        NOW,
    )
    assert admitted.authorized_plan is not None
    return admitted.authorized_plan


class SyntheticTarget:
    def __init__(self, *, observed: object | None = None, fail_observe: bool = False, effect_refs=("effect:one",)):
        self.calls = 0
        self.observe_calls = 0
        self.observed = observed
        self.fail_observe = fail_observe
        self.effect_refs = tuple(effect_refs)

    def execute(self, plan: ActionPlan) -> DispatchEffect:
        self.calls += 1
        expected = {"plan": plan.plan_id, "revision": self.calls}
        return DispatchEffect(self.effect_refs, expected)

    def observe(self, plan: ActionPlan, receipt) -> object:
        self.observe_calls += 1
        if self.fail_observe:
            raise RuntimeError("synthetic observer unavailable")
        return self.observed if self.observed is not None else {"plan": plan.plan_id, "revision": 1}


class DispatchTask23Tests(unittest.TestCase):
    def test_success_preserves_trace_and_appends_execution_then_verification(self) -> None:
        target = SyntheticTarget()
        audit = AuditReceiptStore()
        result = BoundedDispatcher(target, audit, clock=lambda: NOW).dispatch(authorized_runtime())

        self.assertEqual(result.execution.outcome, ExecutionOutcome.SUCCEEDED)
        self.assertEqual(result.execution.idempotency_key, "idem:dispatch")
        self.assertIsNotNone(result.verification)
        assert result.verification is not None
        self.assertTrue(result.verification.matched)
        self.assertEqual(result.verification.governance_trace, result.execution.governance_trace)
        self.assertEqual([item.kind for item in audit.receipts], [AuditEventKind.EXECUTION, AuditEventKind.VERIFICATION])
        self.assertTrue(audit.verify_chain())

    def test_same_key_replay_is_audited_no_op_and_does_not_execute_again(self) -> None:
        target = SyntheticTarget()
        audit = AuditReceiptStore()
        dispatcher = BoundedDispatcher(target, audit, clock=lambda: NOW)
        first = dispatcher.dispatch(authorized_runtime())
        replay = dispatcher.dispatch(authorized_runtime())

        self.assertTrue(replay.replayed)
        self.assertEqual(replay.execution.execution_ref, first.execution.execution_ref)
        self.assertEqual(target.calls, 1)
        self.assertEqual(target.observe_calls, 1)
        self.assertEqual(audit.receipts[-1].kind, AuditEventKind.SAFE_REPLAY)
        self.assertTrue(audit.verify_chain())

    def test_same_key_with_a_different_plan_is_refused_without_target_effect(self) -> None:
        target = SyntheticTarget()
        dispatcher = BoundedDispatcher(target, clock=lambda: NOW)
        dispatcher.dispatch(authorized_runtime())
        original = authorized_runtime()
        changed_plan = replace(original.plan, scope=("runtime/other-tool",))
        changed = AuthorizedPlan(changed_plan, original.profile_id, original.grants, original.gate)

        with self.assertRaises(DispatchError) as raised:
            dispatcher.dispatch(changed)
        self.assertEqual(raised.exception.code, DispatchCode.IDEMPOTENCY_CONFLICT)
        self.assertEqual(target.calls, 1)

    def test_unknown_verification_blocks_every_replay(self) -> None:
        target = SyntheticTarget(fail_observe=True)
        audit = AuditReceiptStore()
        dispatcher = BoundedDispatcher(target, audit, clock=lambda: NOW)
        with self.assertRaises(DispatchError) as first:
            dispatcher.dispatch(authorized_runtime())
        self.assertEqual(first.exception.code, DispatchCode.VERIFICATION_UNKNOWN)
        with self.assertRaises(DispatchError) as replay:
            dispatcher.dispatch(authorized_runtime())
        self.assertEqual(replay.exception.code, DispatchCode.SAFE_REPLAY_BLOCKED)
        self.assertEqual(target.calls, 1)
        self.assertEqual([item.kind for item in audit.receipts], [AuditEventKind.EXECUTION, AuditEventKind.VERIFICATION_UNKNOWN, AuditEventKind.SAFE_REPLAY_BLOCKED])

    def test_mismatched_post_action_state_is_recorded_and_not_retried(self) -> None:
        target = SyntheticTarget(observed={"plan": "plan:turn:dispatch", "revision": 2})
        dispatcher = BoundedDispatcher(target, clock=lambda: NOW)
        first = dispatcher.dispatch(authorized_runtime())
        replay = dispatcher.dispatch(authorized_runtime())

        self.assertIsNotNone(first.verification)
        assert first.verification is not None
        self.assertFalse(first.verification.matched)
        self.assertTrue(replay.replayed)
        self.assertEqual(target.calls, 1)
        self.assertEqual(target.observe_calls, 1)

    def test_effect_limit_failure_is_unknown_and_cannot_be_replayed(self) -> None:
        target = SyntheticTarget(effect_refs=("effect:one", "effect:two"))
        dispatcher = BoundedDispatcher(target, clock=lambda: NOW)
        with self.assertRaises(DispatchError) as raised:
            dispatcher.dispatch(authorized_runtime())
        self.assertEqual(raised.exception.code, DispatchCode.EFFECT_LIMIT_EXCEEDED)
        with self.assertRaises(DispatchError) as replay:
            dispatcher.dispatch(authorized_runtime())
        self.assertEqual(replay.exception.code, DispatchCode.SAFE_REPLAY_BLOCKED)
        self.assertEqual(target.calls, 1)


if __name__ == "__main__":
    unittest.main()
