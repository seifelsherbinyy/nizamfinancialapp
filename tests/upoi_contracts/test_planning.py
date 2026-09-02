"""Focused offline tests for UPOI task 2.1 planning.

Owning contract: UPOI task 2.1; requirements 1.1, 1.2, 1.4; design sections 6.1, 7.4, and 9.1.
All turns and scopes are synthetic. Planning never invokes a provider, writes a store, or mutates
an external target.
"""

from __future__ import annotations

import unittest

from upoi_contracts import (
    AUTHORITY_RULES,
    ActionRisk,
    AuthorityClass,
    AuthorityRule,
    AuthorityRuleRegistry,
    CheckDefinition,
    ContractValidationError,
    GovernanceTrace,
    OperatorTurn,
    PlanningCode,
    PlanningStatus,
    classify_authority,
    plan_operator_turn,
)


TRACE = GovernanceTrace(("contract:test-governance",), ("requirement:1.1",))


def turn(
    *,
    intent: str = "read_financial_snapshot",
    action: str = "read",
    authority: AuthorityClass | str | None = AuthorityClass.DETERMINISTIC_DOMAIN,
    scope: tuple[str, ...] = ("finance/read/synthetic",),
    key: str | None = "idem:synthetic-turn",
) -> OperatorTurn:
    return OperatorTurn(
        turn_ref="turn:synthetic",
        intent=intent,
        requested_action=action,
        target_authority=authority,
        scope=scope,
        idempotency_key=key,
    )


class PlanningTests(unittest.TestCase):
    def test_read_only_turn_is_classified_and_planned_without_grant_or_effect(self) -> None:
        decision = plan_operator_turn(turn())

        self.assertEqual(decision.status, PlanningStatus.PLANNED)
        self.assertIsNotNone(decision.plan)
        assert decision.plan is not None
        self.assertEqual(decision.plan.target_authority, AuthorityClass.DETERMINISTIC_DOMAIN)
        self.assertEqual(decision.plan.risk, ActionRisk.READ_ONLY)
        self.assertEqual(decision.plan.required_grant_scopes, ())
        self.assertIsNone(decision.plan.human_gate)
        self.assertEqual(decision.external_effect_count, 0)

    def test_runtime_rule_classifies_grant_requirement_and_rollback_without_minting_grant(self) -> None:
        decision = plan_operator_turn(
            turn(
                intent="invoke_bounded_runtime",
                action="invoke",
                authority=AuthorityClass.EXECUTION_RUNTIME,
                scope=("runtime/synthetic-tool",),
            )
        )

        self.assertEqual(decision.status, PlanningStatus.PLANNED)
        assert decision.plan is not None
        self.assertEqual(decision.plan.risk, ActionRisk.LOCAL_REVERSIBLE)
        self.assertEqual(decision.plan.required_grant_scopes, ("runtime:invoke",))
        self.assertEqual(decision.plan.required_grants, ())
        self.assertEqual(decision.plan.rollback_ref, "rollback:runtime-invocation")
        self.assertIsNone(decision.plan.human_gate)

    def test_financial_write_is_human_gated_before_any_dispatch(self) -> None:
        decision = plan_operator_turn(
            turn(
                intent="append_financial_command",
                action="append",
                authority=AuthorityClass.DETERMINISTIC_DOMAIN,
                scope=("finance/write/synthetic",),
            )
        )

        self.assertEqual(decision.status, PlanningStatus.PLANNED)
        assert decision.plan is not None
        self.assertEqual(decision.plan.risk, ActionRisk.HUMAN_GATED)
        self.assertEqual(decision.plan.human_gate, "gate:owner-finance-command")
        self.assertEqual(decision.plan.required_grant_scopes, ("finance:append",))
        self.assertEqual(decision.external_effect_count, 0)

    def test_unknown_authority_refuses_without_creating_a_plan(self) -> None:
        decision = plan_operator_turn(turn(authority="unknown-domain"))

        self.assertEqual(decision.status, PlanningStatus.REFUSED)
        self.assertEqual(decision.code, PlanningCode.UNSUPPORTED_AUTHORITY)
        self.assertIsNone(decision.plan)
        self.assertEqual(decision.external_effect_count, 0)

    def test_uncovered_intent_refuses_without_inference(self) -> None:
        decision = plan_operator_turn(turn(intent="invent_new_authority", action="mutate"))

        self.assertEqual(decision.status, PlanningStatus.REFUSED)
        self.assertEqual(decision.code, PlanningCode.AUTHORITY_RULE_NOT_COVERED)
        self.assertIsNone(decision.plan)
        self.assertEqual(decision.external_effect_count, 0)

    def test_missing_authority_requests_bounded_clarification(self) -> None:
        decision = plan_operator_turn(turn(authority=None))

        self.assertEqual(decision.status, PlanningStatus.CLARIFICATION_REQUIRED)
        self.assertEqual(decision.code, PlanningCode.AUTHORITY_NOT_SPECIFIED)
        self.assertEqual(decision.clarification_fields, ("target_authority", "scope"))
        self.assertIsNone(decision.plan)
        self.assertEqual(decision.external_effect_count, 0)

    def test_missing_idempotency_or_scope_requests_clarification(self) -> None:
        for candidate, code, field in (
            (turn(key=None), PlanningCode.MISSING_IDEMPOTENCY_KEY, "idempotency_key"),
            (turn(scope=()), PlanningCode.MISSING_SCOPE, "scope"),
        ):
            with self.subTest(code=code):
                decision = plan_operator_turn(candidate)
                self.assertEqual(decision.status, PlanningStatus.CLARIFICATION_REQUIRED)
                self.assertEqual(decision.code, code)
                self.assertIn(field, decision.clarification_fields)
                self.assertEqual(decision.external_effect_count, 0)

    def test_scope_outside_rule_is_refused(self) -> None:
        decision = plan_operator_turn(turn(scope=("finance/write/synthetic",)))

        self.assertEqual(decision.status, PlanningStatus.REFUSED)
        self.assertEqual(decision.code, PlanningCode.SCOPE_NOT_COVERED)
        self.assertIsNone(decision.plan)
        self.assertEqual(decision.external_effect_count, 0)

    def test_classification_exposes_all_dispatch_inputs_without_effect(self) -> None:
        classification = classify_authority(
            turn(
                intent="archive_sanitized_artifact",
                action="write",
                authority=AuthorityClass.ARCHIVE,
                scope=("archive/write/synthetic",),
            )
        )

        self.assertEqual(classification.target_authority, AuthorityClass.ARCHIVE)
        self.assertEqual(classification.risk, ActionRisk.HUMAN_GATED)
        self.assertEqual(classification.required_grant_scopes, ("archive:write",))
        self.assertEqual(classification.human_gate, "gate:owner-archive-write")
        self.assertEqual(classification.rollback_ref, "rollback:archive-artifact")

    def test_registry_rejects_duplicate_authority_match_keys(self) -> None:
        rule = AUTHORITY_RULES.rules[0]
        with self.assertRaises(ContractValidationError):
            AuthorityRuleRegistry((rule, rule))

    def test_malformed_custom_rule_cannot_remove_rollback_or_gate(self) -> None:
        with self.assertRaises(ContractValidationError):
            AuthorityRule(
                rule_id="unsafe",
                intent="unsafe",
                requested_action="mutate",
                target_authority=AuthorityClass.EXECUTION_RUNTIME,
                risk=ActionRisk.HUMAN_GATED,
                allowed_scope_prefixes=("runtime/",),
                required_grant_scopes=("runtime:invoke",),
                human_gate=None,
                preconditions=(CheckDefinition("pre", "synthetic"),),
                postconditions=(CheckDefinition("post", "synthetic"),),
                rollback_ref=None,
                governance_trace=TRACE,
            )


if __name__ == "__main__":
    unittest.main()
