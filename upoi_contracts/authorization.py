"""Fail-closed grant admission and human-gate enforcement.

Owning contract: UPOI task 2.2; requirements 1.1 and 1.2; design sections 8.2, 14.2, and 22.
This pure offline boundary accepts only typed plans, grants, gates, and profile policy. It never
executes effects, infers owner approval, reads context, or exposes guard-specific refusal details.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from typing import Iterable

from .models import (
    ActionPlan,
    ActionRisk,
    AuthorityClass,
    Gate,
    GateKind,
    GateState,
    Grant,
)


class AuthorizationStatus(str, Enum):
    ACCEPTED = "ACCEPTED"
    BLOCKED = "BLOCKED"


class AuthorizationCode(str, Enum):
    MISSING_GRANT = "MISSING_GRANT"
    STALE_GRANT = "STALE_GRANT"
    GRANT_PROFILE_MISMATCH = "GRANT_PROFILE_MISMATCH"
    GRANT_AUTHORITY_MISMATCH = "GRANT_AUTHORITY_MISMATCH"
    GRANT_SCOPE_MISMATCH = "GRANT_SCOPE_MISMATCH"
    GRANT_OVER_BROAD = "GRANT_OVER_BROAD"
    GRANT_IDEMPOTENCY_MISMATCH = "GRANT_IDEMPOTENCY_MISMATCH"
    MISSING_HUMAN_GATE = "MISSING_HUMAN_GATE"
    HUMAN_GATE_MISMATCH = "HUMAN_GATE_MISMATCH"
    HUMAN_GATE_NOT_APPROVED = "HUMAN_GATE_NOT_APPROVED"
    HUMAN_GATE_SCOPE_MISMATCH = "HUMAN_GATE_SCOPE_MISMATCH"
    HUMAN_GATE_STALE = "HUMAN_GATE_STALE"
    UNEXPECTED_GRANT = "UNEXPECTED_GRANT"
    UNEXPECTED_GATE = "UNEXPECTED_GATE"
    INVALID_PROFILE_POLICY = "INVALID_PROFILE_POLICY"


@dataclass(frozen=True, slots=True)
class ProfilePolicy:
    """The only profile facts used during admission; scope is an allowlist of prefixes."""

    profile_id: str
    recipient: AuthorityClass
    allowed_scope_prefixes: tuple[str, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.profile_id, str) or not self.profile_id.strip():
            raise ValueError("profile_id must be a non-empty string")
        if not isinstance(self.recipient, AuthorityClass):
            raise ValueError("recipient must be AuthorityClass")
        if (
            not isinstance(self.allowed_scope_prefixes, tuple)
            or not self.allowed_scope_prefixes
            or any(not isinstance(item, str) or not item.strip() for item in self.allowed_scope_prefixes)
        ):
            raise ValueError("allowed_scope_prefixes must contain non-empty prefixes")


@dataclass(frozen=True, slots=True)
class AuthorizedPlan:
    plan: ActionPlan
    profile_id: str
    grants: tuple[Grant, ...]
    gate: Gate | None


@dataclass(frozen=True, slots=True)
class AuthorizationDecision:
    """Admission result; a blocked decision always reports zero external effects."""

    status: AuthorizationStatus
    code: AuthorizationCode | None
    authorized_plan: AuthorizedPlan | None = None
    message: str = ""
    next_owner_action: str | None = None
    external_effect_count: int = 0

    def __post_init__(self) -> None:
        if self.external_effect_count != 0:
            raise ValueError("authorization cannot report an external effect")
        if self.status is AuthorizationStatus.ACCEPTED:
            if self.code is not None or self.authorized_plan is None or self.next_owner_action is not None:
                raise ValueError("accepted authorization requires only an admitted plan")
        else:
            if self.code is None or self.authorized_plan is not None:
                raise ValueError("blocked authorization requires a code and no admitted plan")
            if not self.message.strip() or not self.next_owner_action or not self.next_owner_action.strip():
                raise ValueError("blocked authorization requires a public message and one next owner action")


_PUBLIC_BLOCKED_MESSAGE = "This plan is blocked pending explicit owner authorization."
_GRANT_NEXT_ACTION = "Owner supplies one explicit, current grant for this plan through the governance process."
_GATE_NEXT_ACTION = "Owner records one explicit approval for this plan through its human gate."


def _is_utc(value: datetime) -> bool:
    return isinstance(value, datetime) and value.tzinfo is not None and value.utcoffset() == timedelta(0)


def _blocked(code: AuthorizationCode, plan: ActionPlan) -> AuthorizationDecision:
    return AuthorizationDecision(
        status=AuthorizationStatus.BLOCKED,
        code=code,
        message=_PUBLIC_BLOCKED_MESSAGE,
        next_owner_action=_GATE_NEXT_ACTION if plan.human_gate else _GRANT_NEXT_ACTION,
    )


def _within_profile(scope: str, prefixes: tuple[str, ...]) -> bool:
    return any(scope.startswith(prefix) for prefix in prefixes)


def _required_scope(plan: ActionPlan) -> frozenset[str]:
    return frozenset((*plan.scope, *plan.required_grant_scopes))


def authorize_plan(
    plan: ActionPlan,
    profile: ProfilePolicy,
    grants: Iterable[Grant],
    gates: Iterable[Gate],
    now: datetime,
) -> AuthorizationDecision:
    """Admit a plan only when every grant and required human gate is explicit and bounded.

    The function is intentionally a pure admission check. It does not mint grants, interpret
    prose, consult historical receipts, or invoke a runtime. Its public blocked message is the
    same for every guard failure, while ``code`` remains available to local audit/test callers.
    """

    if not isinstance(plan, ActionPlan):
        raise TypeError("plan must be an ActionPlan")
    if not isinstance(profile, ProfilePolicy):
        raise TypeError("profile must be a ProfilePolicy")
    if not _is_utc(now):
        raise ValueError("now must be an aware UTC datetime")

    grant_values = tuple(grants)
    gate_values = tuple(gates)
    if not all(isinstance(item, Grant) for item in grant_values):
        return _blocked(AuthorizationCode.MISSING_GRANT, plan)
    if not all(isinstance(item, Gate) for item in gate_values):
        return _blocked(AuthorizationCode.MISSING_HUMAN_GATE, plan)

    if plan.target_authority is not profile.recipient:
        return _blocked(AuthorizationCode.GRANT_AUTHORITY_MISMATCH, plan)

    required_scope = _required_scope(plan)
    is_consequential = plan.risk is not ActionRisk.READ_ONLY
    requires_grant = is_consequential or bool(plan.required_grant_scopes)
    if requires_grant and not grant_values:
        return _blocked(AuthorizationCode.MISSING_GRANT, plan)
    if not requires_grant and grant_values:
        return _blocked(AuthorizationCode.UNEXPECTED_GRANT, plan)

    if grant_values:
        if len({grant.grant_id for grant in grant_values}) != len(grant_values):
            return _blocked(AuthorizationCode.GRANT_OVER_BROAD, plan)
        grant_scope = set()
        for grant in grant_values:
            if grant.profile_id != profile.profile_id:
                return _blocked(AuthorizationCode.GRANT_PROFILE_MISMATCH, plan)
            if grant.issuer is not AuthorityClass.GOVERNANCE or grant.recipient is not profile.recipient:
                return _blocked(AuthorizationCode.GRANT_AUTHORITY_MISMATCH, plan)
            if grant.idempotency_key != plan.idempotency_key:
                return _blocked(AuthorizationCode.GRANT_IDEMPOTENCY_MISMATCH, plan)
            if grant.issued_at > now or grant.expires_at <= now:
                return _blocked(AuthorizationCode.STALE_GRANT, plan)
            if any(not _within_profile(scope, profile.allowed_scope_prefixes) for scope in grant.scope):
                return _blocked(AuthorizationCode.GRANT_SCOPE_MISMATCH, plan)
            if plan.human_gate is not None:
                if grant.gate_id != plan.human_gate:
                    return _blocked(AuthorizationCode.HUMAN_GATE_MISMATCH, plan)
            elif grant.gate_id is not None:
                return _blocked(AuthorizationCode.UNEXPECTED_GRANT, plan)
            grant_scope.update(grant.scope)

        if not required_scope.issubset(grant_scope):
            return _blocked(AuthorizationCode.GRANT_SCOPE_MISMATCH, plan)
        if grant_scope != set(required_scope):
            return _blocked(AuthorizationCode.GRANT_OVER_BROAD, plan)

    if plan.human_gate is None:
        if gate_values:
            return _blocked(AuthorizationCode.UNEXPECTED_GATE, plan)
        return AuthorizationDecision(
            status=AuthorizationStatus.ACCEPTED,
            code=None,
            authorized_plan=AuthorizedPlan(plan, profile.profile_id, grant_values, None),
        )

    if len(gate_values) != 1:
        return _blocked(AuthorizationCode.MISSING_HUMAN_GATE, plan)
    gate = gate_values[0]
    if gate.gate_id != plan.human_gate or gate.kind is not GateKind.HUMAN:
        return _blocked(AuthorizationCode.HUMAN_GATE_MISMATCH, plan)
    if gate.state is not GateState.APPROVED or gate.approver is not AuthorityClass.OWNER:
        return _blocked(AuthorizationCode.HUMAN_GATE_NOT_APPROVED, plan)
    if gate.requested_at > now or gate.decided_at is None or gate.decided_at > now:
        return _blocked(AuthorizationCode.HUMAN_GATE_STALE, plan)
    if set(gate.scope) != set(plan.scope):
        return _blocked(AuthorizationCode.HUMAN_GATE_SCOPE_MISMATCH, plan)

    return AuthorizationDecision(
        status=AuthorizationStatus.ACCEPTED,
        code=None,
        authorized_plan=AuthorizedPlan(plan, profile.profile_id, grant_values, gate),
    )


__all__ = [
    "AuthorizedPlan",
    "AuthorizationCode",
    "AuthorizationDecision",
    "AuthorizationStatus",
    "ProfilePolicy",
    "authorize_plan",
]
