"""Offline operator-turn planning and authority classification.

Owning contract: UPOI task 2.1; requirements 1.1, 1.2, 1.4; design sections 6.1, 7.4, and 9.1.
The planner is a pure boundary: it classifies bounded synthetic turns and constructs immutable
plans, but it has no dispatch, persistence, network, provider, secret, or financial-calculation
capability. Grant scopes are requirements only; task 2.2 is responsible for grant admission.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Iterable, TypeAlias

from .models import (
    ActionPlan,
    ActionRisk,
    AuthorityClass,
    CheckDefinition,
    ContractValidationError,
    GovernanceTrace,
)


class PlanningStatus(str, Enum):
    PLANNED = "PLANNED"
    CLARIFICATION_REQUIRED = "CLARIFICATION_REQUIRED"
    REFUSED = "REFUSED"


class PlanningCode(str, Enum):
    MISSING_IDEMPOTENCY_KEY = "MISSING_IDEMPOTENCY_KEY"
    MISSING_SCOPE = "MISSING_SCOPE"
    AUTHORITY_NOT_SPECIFIED = "AUTHORITY_NOT_SPECIFIED"
    UNSUPPORTED_AUTHORITY = "UNSUPPORTED_AUTHORITY"
    AUTHORITY_RULE_NOT_COVERED = "AUTHORITY_RULE_NOT_COVERED"
    SCOPE_NOT_COVERED = "SCOPE_NOT_COVERED"
    INVALID_AUTHORITY_RULE = "INVALID_AUTHORITY_RULE"


@dataclass(frozen=True, slots=True)
class OperatorTurn:
    """A bounded, already-accepted operator intent; it is not an executable command."""

    turn_ref: str
    intent: str
    requested_action: str
    target_authority: AuthorityClass | str | None
    scope: tuple[str, ...] = ()
    idempotency_key: str | None = None
    plan_id: str | None = None

    def __post_init__(self) -> None:
        for field, value in (
            ("turn_ref", self.turn_ref),
            ("intent", self.intent),
            ("requested_action", self.requested_action),
        ):
            if not isinstance(value, str) or not value.strip():
                raise ContractValidationError(f"{field} must be a non-empty string")
        if not isinstance(self.scope, tuple) or any(not isinstance(item, str) or not item.strip() for item in self.scope):
            raise ContractValidationError("scope must be a tuple of non-empty references")
        if self.idempotency_key is not None and (not isinstance(self.idempotency_key, str) or not self.idempotency_key.strip()):
            raise ContractValidationError("idempotency_key must be non-empty when supplied")
        if self.plan_id is not None and (not isinstance(self.plan_id, str) or not self.plan_id.strip()):
            raise ContractValidationError("plan_id must be non-empty when supplied")


@dataclass(frozen=True, slots=True)
class AuthorityRule:
    """An accepted, exact intent/action/authority mapping owned by governance."""

    rule_id: str
    intent: str
    requested_action: str
    target_authority: AuthorityClass
    risk: ActionRisk
    allowed_scope_prefixes: tuple[str, ...]
    required_grant_scopes: tuple[str, ...]
    human_gate: str | None
    preconditions: tuple[CheckDefinition, ...]
    postconditions: tuple[CheckDefinition, ...]
    rollback_ref: str | None
    governance_trace: GovernanceTrace

    def __post_init__(self) -> None:
        for field, value in (
            ("rule_id", self.rule_id),
            ("intent", self.intent),
            ("requested_action", self.requested_action),
        ):
            if not isinstance(value, str) or not value.strip():
                raise ContractValidationError(f"{field} must be a non-empty string")
        if not isinstance(self.target_authority, AuthorityClass):
            raise ContractValidationError("target_authority must be AuthorityClass")
        if not isinstance(self.risk, ActionRisk):
            raise ContractValidationError("risk must be ActionRisk")
        self._validate_refs(self.allowed_scope_prefixes, "allowed_scope_prefixes")
        self._validate_refs(self.required_grant_scopes, "required_grant_scopes", required=False)
        if len(set(self.required_grant_scopes)) != len(self.required_grant_scopes):
            raise ContractValidationError("required_grant_scopes must not contain duplicates")
        if self.human_gate is not None and (not isinstance(self.human_gate, str) or not self.human_gate.strip()):
            raise ContractValidationError("human_gate must be non-empty when supplied")
        self._validate_checks(self.preconditions, "preconditions")
        self._validate_checks(self.postconditions, "postconditions")
        if self.rollback_ref is not None and (not isinstance(self.rollback_ref, str) or not self.rollback_ref.strip()):
            raise ContractValidationError("rollback_ref must be non-empty when supplied")
        if not isinstance(self.governance_trace, GovernanceTrace):
            raise ContractValidationError("governance_trace must be a GovernanceTrace")
        if self.risk is not ActionRisk.READ_ONLY and self.rollback_ref is None:
            raise ContractValidationError("consequential authority rules require a rollback_ref")
        if self.risk in {ActionRisk.HUMAN_GATED, ActionRisk.IRREVERSIBLE} and self.human_gate is None:
            raise ContractValidationError("human-gated and irreversible rules require a human_gate")
        if self.target_authority is AuthorityClass.EVIDENCE_ONLY and self.risk is not ActionRisk.READ_ONLY:
            raise ContractValidationError("evidence-only authority cannot be an effect target")

    @staticmethod
    def _validate_refs(values: tuple[str, ...], field: str, *, required: bool = True) -> None:
        if not isinstance(values, tuple) or (required and not values):
            raise ContractValidationError(f"{field} must be a non-empty tuple of references")
        if any(not isinstance(value, str) or not value.strip() for value in values):
            raise ContractValidationError(f"{field} must contain non-empty references")

    @staticmethod
    def _validate_checks(values: tuple[CheckDefinition, ...], field: str) -> None:
        if not isinstance(values, tuple) or not values or not all(isinstance(value, CheckDefinition) for value in values):
            raise ContractValidationError(f"{field} must contain CheckDefinition values")
        if len({value.check_id for value in values}) != len(values):
            raise ContractValidationError(f"{field} must not contain duplicate check ids")


@dataclass(frozen=True, slots=True)
class AuthorityClassification:
    """The governance classification used to construct, but not execute, a plan."""

    rule_id: str
    intent: str
    requested_action: str
    target_authority: AuthorityClass
    risk: ActionRisk
    scope: tuple[str, ...]
    required_grant_scopes: tuple[str, ...]
    human_gate: str | None
    preconditions: tuple[CheckDefinition, ...]
    postconditions: tuple[CheckDefinition, ...]
    rollback_ref: str | None
    governance_trace: GovernanceTrace


@dataclass(frozen=True, slots=True)
class PlanDecision:
    """A plan or a bounded no-effect response; no decision variant dispatches an effect."""

    status: PlanningStatus
    plan: ActionPlan | None = None
    code: PlanningCode | None = None
    summary: str = ""
    next_owner_action: str | None = None
    clarification_fields: tuple[str, ...] = ()
    external_effect_count: int = 0

    def __post_init__(self) -> None:
        if self.external_effect_count != 0:
            raise ContractValidationError("planning decisions cannot report an external effect")
        if self.status is PlanningStatus.PLANNED:
            if self.plan is None or self.code is not None:
                raise ContractValidationError("a planned decision requires only a plan")
        else:
            if self.plan is not None or self.code is None:
                raise ContractValidationError("a bounded issue requires a code and no plan")
            if not self.summary.strip():
                raise ContractValidationError("a bounded issue requires a summary")


AuthorityClassificationResult: TypeAlias = AuthorityClassification | PlanDecision


class AuthorityRuleRegistry:
    """Immutable exact-match registry; absent entries are not inferred."""

    def __init__(self, rules: Iterable[AuthorityRule]) -> None:
        ordered = tuple(rules)
        keys = [(rule.intent, rule.requested_action, rule.target_authority) for rule in ordered]
        if len(set(keys)) != len(keys):
            raise ContractValidationError("authority rules must not contain duplicate match keys")
        self._rules = ordered
        self._by_key = {key: rule for key, rule in zip(keys, ordered)}

    @property
    def rules(self) -> tuple[AuthorityRule, ...]:
        return self._rules

    def find(self, intent: str, requested_action: str, target_authority: AuthorityClass) -> AuthorityRule | None:
        return self._by_key.get((intent, requested_action, target_authority))


def _trace() -> GovernanceTrace:
    return GovernanceTrace(("contract:upoi-governance",), ("requirement:1.1", "requirement:1.2", "requirement:1.4"))


def _check(check_id: str, description: str) -> CheckDefinition:
    return CheckDefinition(check_id, description)


def _rule(
    rule_id: str,
    intent: str,
    action: str,
    authority: AuthorityClass,
    risk: ActionRisk,
    scope_prefix: str,
    grant_scopes: tuple[str, ...] = (),
    gate: str | None = None,
    rollback: str | None = None,
) -> AuthorityRule:
    return AuthorityRule(
        rule_id=rule_id,
        intent=intent,
        requested_action=action,
        target_authority=authority,
        risk=risk,
        allowed_scope_prefixes=(scope_prefix,),
        required_grant_scopes=grant_scopes,
        human_gate=gate,
        preconditions=(_check(f"{rule_id}:preconditions", "The bounded authority and input scope are available."),),
        postconditions=(_check(f"{rule_id}:postconditions", "The planned outcome can be independently verified."),),
        rollback_ref=rollback,
        governance_trace=_trace(),
    )


AUTHORITY_RULES = AuthorityRuleRegistry(
    (
        _rule("read-financial", "read_financial_snapshot", "read", AuthorityClass.DETERMINISTIC_DOMAIN, ActionRisk.READ_ONLY, "finance/read/"),
        _rule("read-context", "retrieve_context", "read", AuthorityClass.CONTEXT, ActionRisk.READ_ONLY, "context/read/"),
        _rule("prepare-reply", "prepare_operator_reply", "prepare", AuthorityClass.OPERATOR_INTERFACE, ActionRisk.READ_ONLY, "operator/reply/"),
        _rule("record-evidence", "record_evidence", "append", AuthorityClass.EVIDENCE_ONLY, ActionRisk.READ_ONLY, "evidence/"),
        _rule(
            "invoke-runtime",
            "invoke_bounded_runtime",
            "invoke",
            AuthorityClass.EXECUTION_RUNTIME,
            ActionRisk.LOCAL_REVERSIBLE,
            "runtime/",
            ("runtime:invoke",),
            rollback="rollback:runtime-invocation",
        ),
        _rule(
            "append-finance",
            "append_financial_command",
            "append",
            AuthorityClass.DETERMINISTIC_DOMAIN,
            ActionRisk.HUMAN_GATED,
            "finance/write/",
            ("finance:append",),
            gate="gate:owner-finance-command",
            rollback="rollback:finance-command",
        ),
        _rule(
            "archive-artifact",
            "archive_sanitized_artifact",
            "write",
            AuthorityClass.ARCHIVE,
            ActionRisk.HUMAN_GATED,
            "archive/write/",
            ("archive:write",),
            gate="gate:owner-archive-write",
            rollback="rollback:archive-artifact",
        ),
    )
)


def _issue(
    status: PlanningStatus,
    code: PlanningCode,
    summary: str,
    next_owner_action: str,
    clarification_fields: tuple[str, ...] = (),
) -> PlanDecision:
    return PlanDecision(
        status=status,
        code=code,
        summary=summary,
        next_owner_action=next_owner_action,
        clarification_fields=clarification_fields,
    )


def _scope_is_allowed(scope: tuple[str, ...], prefixes: tuple[str, ...]) -> bool:
    return all(any(item.startswith(prefix) for prefix in prefixes) for item in scope)


def classify_authority(
    turn: OperatorTurn,
    registry: AuthorityRuleRegistry = AUTHORITY_RULES,
) -> AuthorityClassificationResult:
    """Classify one turn using only an exact accepted authority rule.

    This function is pure and side-effect free. It deliberately does not coerce unknown authority
    strings into an enum and does not infer a rule from a similar intent, target, or scope.
    """

    if turn.target_authority is None:
        return _issue(
            PlanningStatus.CLARIFICATION_REQUIRED,
            PlanningCode.AUTHORITY_NOT_SPECIFIED,
            "The requested authority is not specified.",
            "Name one accepted authority class and one bounded scope.",
            ("target_authority", "scope"),
        )
    if not isinstance(turn.target_authority, AuthorityClass):
        return _issue(
            PlanningStatus.REFUSED,
            PlanningCode.UNSUPPORTED_AUTHORITY,
            "No accepted authority class covers this request.",
            "Owner names an accepted authority class before resubmitting the bounded request.",
        )
    if turn.idempotency_key is None:
        return _issue(
            PlanningStatus.CLARIFICATION_REQUIRED,
            PlanningCode.MISSING_IDEMPOTENCY_KEY,
            "The request has no idempotency key for safe planning.",
            "Provide one stable idempotency key; no action is dispatched while it is absent.",
            ("idempotency_key",),
        )
    if not turn.scope:
        return _issue(
            PlanningStatus.CLARIFICATION_REQUIRED,
            PlanningCode.MISSING_SCOPE,
            "The request has no bounded scope.",
            "Provide the smallest explicit scope for the requested action.",
            ("scope",),
        )

    rule = registry.find(turn.intent, turn.requested_action, turn.target_authority)
    if rule is None:
        return _issue(
            PlanningStatus.REFUSED,
            PlanningCode.AUTHORITY_RULE_NOT_COVERED,
            "No accepted authority rule covers this intent, action, and target.",
            "Owner supplies an accepted contract rule or keeps the request in read-only clarification.",
        )
    if not _scope_is_allowed(turn.scope, rule.allowed_scope_prefixes):
        return _issue(
            PlanningStatus.REFUSED,
            PlanningCode.SCOPE_NOT_COVERED,
            "The requested scope is outside the accepted authority rule.",
            "Owner narrows the request to the rule's bounded scope; no external effect is permitted.",
        )

    return AuthorityClassification(
        rule_id=rule.rule_id,
        intent=turn.intent,
        requested_action=turn.requested_action,
        target_authority=rule.target_authority,
        risk=rule.risk,
        scope=turn.scope,
        required_grant_scopes=rule.required_grant_scopes,
        human_gate=rule.human_gate,
        preconditions=rule.preconditions,
        postconditions=rule.postconditions,
        rollback_ref=rule.rollback_ref,
        governance_trace=rule.governance_trace,
    )


def plan_operator_turn(
    turn: OperatorTurn,
    registry: AuthorityRuleRegistry = AUTHORITY_RULES,
) -> PlanDecision:
    """Build an immutable plan, or return a bounded no-effect refusal/clarification."""

    classification = classify_authority(turn, registry)
    if not isinstance(classification, AuthorityClassification):
        return classification

    plan_id = turn.plan_id or f"plan:{turn.turn_ref}"
    try:
        plan = ActionPlan(
            plan_id=plan_id,
            intent=classification.intent,
            target_authority=classification.target_authority,
            risk=classification.risk,
            idempotency_key=turn.idempotency_key or "",
            required_grants=(),
            human_gate=classification.human_gate,
            preconditions=classification.preconditions,
            postconditions=classification.postconditions,
            rollback_ref=classification.rollback_ref,
            governance_trace=classification.governance_trace,
            required_grant_scopes=classification.required_grant_scopes,
            scope=classification.scope,
        )
    except ContractValidationError:
        return _issue(
            PlanningStatus.REFUSED,
            PlanningCode.INVALID_AUTHORITY_RULE,
            "The accepted authority rule cannot produce a valid action plan.",
            "Owner repairs the governing contract rule before any dispatch is considered.",
        )
    return PlanDecision(status=PlanningStatus.PLANNED, plan=plan)


__all__ = [
    "AUTHORITY_RULES",
    "AuthorityClassification",
    "AuthorityClassificationResult",
    "AuthorityRule",
    "AuthorityRuleRegistry",
    "OperatorTurn",
    "PlanDecision",
    "PlanningCode",
    "PlanningStatus",
    "classify_authority",
    "plan_operator_turn",
]
