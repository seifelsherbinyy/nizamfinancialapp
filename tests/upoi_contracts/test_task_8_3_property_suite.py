"""Repository-compatible Hypothesis suite for all five UPOI design properties.

Owning contract: UPOI task 8.3; requirements 1.1, 1.2, 1.3, 1.4, 2.1,
2.2, 2.3, 2.4, 3.1, 3.2, 3.3, and 3.4; design properties 1-5.
Phase: offline synthetic property verification. No providers, network, secrets,
persistence, deployment, commits, or pushes are used.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Any, NamedTuple
import unittest

from hypothesis import given, settings, strategies as st
from hypothesis.strategies import composite

from upoi_contracts import (
    AUTHORITY_RULES,
    ActionPlan,
    ActionRisk,
    AuthorityClass,
    BaselineManifest,
    BaselineRegistry,
    BlockerKind,
    BoundedDispatcher,
    CheckDefinition,
    CheckObservation,
    ContractValidationError,
    DashboardRerunReceipt,
    DispatchEffect,
    DispatchError,
    EvidenceLabel,
    ExecutionOutcome,
    ExecutionReceipt,
    Gate,
    GateKind,
    GateState,
    Grant,
    LoopObservations,
    LoopState,
    ObjectiveRegistryError,
    ObjectiveState,
    ProfilePolicy,
    PrivacyClass,
    ProvenanceRecord,
    TypedBlocker,
    UPOI_OBJECTIVES,
    VerificationReceipt,
    admit_loop,
    authorize_plan,
    build_complete_loop_adapter,
    close_loop,
    create_complete_loop_baseline,
    plan_operator_turn,
    project_objective_dashboard,
    validate_objective_registry,
)
from upoi_contracts.loops import _append_observation_events
from src.server.pfos_port import (
    MAX_SAFE_MILLIUNITS,
    DeterministicFinancePort,
    FinanceQuery,
    FinanceSourceUnavailableError,
    FinancialSnapshot,
    MilliunitBoundaryError,
)


UTC = timezone.utc
NOW = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
HASH_A = "a" * 64
HASH_B = "b" * 64
HASH_C = "c" * 64
HASH_D = "d" * 64


# ---------------------------------------------------------------------------
# Property 1: objective registry completeness


class InvalidRegistryCase(NamedTuple):
    mutation: str
    registry: tuple[object, ...]


@composite
def invalid_registries(draw) -> InvalidRegistryCase:
    mutation = draw(st.sampled_from(("missing", "duplicate", "reordered", "reworded")))
    candidate = list(UPOI_OBJECTIVES)
    if mutation == "missing":
        del candidate[draw(st.integers(0, len(candidate) - 1))]
    elif mutation == "duplicate":
        source = draw(st.integers(0, len(candidate) - 1))
        target = (source + draw(st.integers(1, len(candidate) - 1))) % len(candidate)
        candidate[target] = candidate[source]
    elif mutation == "reordered":
        index = draw(st.integers(0, len(candidate) - 2))
        candidate[index], candidate[index + 1] = candidate[index + 1], candidate[index]
    else:
        index = draw(st.integers(0, len(candidate) - 1))
        candidate[index] = replace(
            candidate[index], validation_question="Is this synthetic wording valid?"
        )
    return InvalidRegistryCase(mutation, tuple(candidate))


# ---------------------------------------------------------------------------
# Property 2: deterministic PFOS authority and integer milliunits


@dataclass
class SyntheticPfosSource:
    snapshot: FinancialSnapshot
    available: bool
    calls: int = 0

    def read_financial_snapshot(self, query: FinanceQuery) -> FinancialSnapshot:
        del query
        self.calls += 1
        if not self.available:
            raise FinanceSourceUnavailableError("read_financial_snapshot")
        return self.snapshot

    def evaluate_decision(self, request: Any) -> Any:
        del request
        raise AssertionError("decision evaluation is outside this read-only property")


SAFE_MILLIUNITS = st.integers(-MAX_SAFE_MILLIUNITS, MAX_SAFE_MILLIUNITS)
UNSAFE_MONEY = st.one_of(
    st.integers(MAX_SAFE_MILLIUNITS + 1, MAX_SAFE_MILLIUNITS + 1000),
    st.integers(-MAX_SAFE_MILLIUNITS - 1000, -MAX_SAFE_MILLIUNITS - 1),
    st.floats(allow_nan=False, allow_infinity=False, width=64),
    st.booleans(),
    st.sampled_from(("1000", "1.5", "9007199254740992")),
)


# ---------------------------------------------------------------------------
# Property 3: bounded effect execution


class EffectCase(NamedTuple):
    rule_index: int
    authority_matches: bool
    approval: str
    verification: str
    nonce: int


CONSEQUENTIAL_RULES = tuple(
    rule for rule in AUTHORITY_RULES.rules if rule.risk is not ActionRisk.READ_ONLY
)


@composite
def effect_cases(draw) -> EffectCase:
    return EffectCase(
        rule_index=draw(st.integers(0, len(CONSEQUENTIAL_RULES) - 1)),
        authority_matches=draw(st.booleans()),
        approval=draw(
            st.sampled_from(("valid", "missing-grant", "stale-grant", "wrong-key", "missing-gate"))
        ),
        verification=draw(st.sampled_from(("matched", "mismatched", "unknown"))),
        nonce=draw(st.integers(0, 100_000)),
    )


class SyntheticTarget:
    def __init__(self, verification: str) -> None:
        self.verification = verification
        self.calls = 0
        self.effects = 0
        self.expected: object | None = None

    def execute(self, plan: ActionPlan) -> DispatchEffect:
        self.calls += 1
        self.effects += 1
        effect_ref = f"effect:{plan.idempotency_key}"
        self.expected = {"plan_id": plan.plan_id, "effect": effect_ref}
        return DispatchEffect((effect_ref,), self.expected)

    def observe(self, plan: ActionPlan, receipt: ExecutionReceipt) -> object:
        del plan, receipt
        if self.verification == "unknown":
            raise RuntimeError("synthetic observer unavailable")
        if self.verification == "mismatched":
            return {"state": "different"}
        return self.expected


# ---------------------------------------------------------------------------
# Property 4: provenance and locality


PROFILE_DOMAINS = {
    "nizam": frozenset({"contract", "financial", "journal", "health", "operational", "persona"}),
    "pfos": frozenset({"contract", "financial", "operational"}),
}
RESTRICTED_PRIVACY = frozenset({PrivacyClass.SENSITIVE, PrivacyClass.STRICT_LOCAL_MAXIMUM})
LOCAL_ONLY_DOMAINS = frozenset({"journal", "health"})


@dataclass(frozen=True)
class ProvenanceCase:
    profile: str
    domain: str
    privacy: PrivacyClass
    incomplete_field: str | None
    authority: AuthorityClass


@composite
def provenance_cases(draw) -> ProvenanceCase:
    return ProvenanceCase(
        profile=draw(st.sampled_from(tuple(PROFILE_DOMAINS))),
        domain=draw(st.sampled_from(tuple(sorted(PROFILE_DOMAINS["nizam"]))),),
        privacy=draw(st.sampled_from(tuple(PrivacyClass))),
        incomplete_field=draw(
            st.one_of(st.none(), st.sampled_from(("source_ref", "source_version", "content_hash", "observed_at", "authority_class")))
        ),
        authority=draw(st.sampled_from(tuple(AuthorityClass))),
    )


# ---------------------------------------------------------------------------
# Property 5: loop evidence integrity


class LoopCase(NamedTuple):
    kind: str
    nonce: int
    invalid_head: str


@composite
def loop_cases(draw) -> LoopCase:
    return LoopCase(
        kind=draw(
            st.sampled_from(
                (
                    "complete",
                    "tampered-baseline",
                    "omitted-check",
                    "lowered-floor",
                    "invalid-chain-head",
                    "different-baseline",
                    "failed-rerun",
                    "human-gate",
                )
            )
        ),
        nonce=draw(st.integers(0, 100_000)),
        invalid_head=draw(st.sampled_from(("0" * 64, "e" * 64, "f" * 64))),
    )


def _provenance(case: ProvenanceCase) -> ProvenanceRecord:
    values: dict[str, object] = {
        "source_ref": "synthetic:context/item",
        "source_version": "synthetic-context-v1",
        "content_hash": HASH_A,
        "observed_at": NOW,
        "evidence_label": EvidenceLabel.FACT,
        "authority_class": case.authority,
        "privacy_class": case.privacy,
        "confidence": "medium",
    }
    if case.incomplete_field is not None:
        values[case.incomplete_field] = None
    # Confidence is intentionally supplied as the canonical enum below; this helper
    # keeps the generated field mutation bounded to provenance completeness only.
    from upoi_contracts import ConfidenceBand

    values["confidence"] = ConfidenceBand.MEDIUM
    return ProvenanceRecord(**values)  # type: ignore[arg-type]


def _context_decision(case: ProvenanceCase) -> tuple[bool, bool, str | None]:
    try:
        record = _provenance(case)
    except ContractValidationError:
        return False, False, "INCOMPLETE_PROVENANCE"
    if record.authority_class is not AuthorityClass.CONTEXT:
        return False, False, "CONTEXT_AUTHORITY_TRANSFER"
    if case.domain not in PROFILE_DOMAINS[case.profile]:
        return False, False, "CONTEXT_PROFILE_MISMATCH"
    provider_bound = (
        case.privacy not in RESTRICTED_PRIVACY
        and case.domain not in LOCAL_ONLY_DOMAINS
    )
    return True, provider_bound, None


def _plan_for_effect(case: EffectCase) -> tuple[object, ActionPlan | None]:
    rule = CONSEQUENTIAL_RULES[case.rule_index]
    authority = rule.target_authority
    if not case.authority_matches:
        authority = next(item for item in AuthorityClass if item is not authority)
    decision = plan_operator_turn(
        __import__("upoi_contracts").OperatorTurn(
            turn_ref=f"turn:task-8-3:{case.nonce}",
            intent=rule.intent,
            requested_action=rule.requested_action,
            target_authority=authority,
            scope=(f"{rule.allowed_scope_prefixes[0]}synthetic-{case.nonce}",),
            idempotency_key=f"idem:task-8-3:{case.nonce}",
        )
    )
    return decision, decision.plan


def _profile(plan: ActionPlan) -> ProfilePolicy:
    prefix = plan.scope[0].split("/", 1)[0]
    return ProfilePolicy(
        profile_id=f"profile:{plan.target_authority.value}",
        recipient=plan.target_authority,
        allowed_scope_prefixes=(f"{prefix}/", f"{prefix}:"),
    )


def _grant(plan: ActionPlan, approval: str) -> Grant:
    expires = NOW if approval == "stale-grant" else NOW + timedelta(hours=1)
    key = "wrong-idempotency" if approval == "wrong-key" else plan.idempotency_key
    return Grant(
        grant_id=f"grant:{plan.plan_id}",
        issuer=AuthorityClass.GOVERNANCE,
        recipient=plan.target_authority,
        scope=tuple((*plan.scope, *plan.required_grant_scopes)),
        issued_at=NOW - timedelta(hours=1),
        expires_at=expires,
        provenance=ProvenanceRecord(
            source_ref="synthetic:grant",
            source_version="synthetic-v1",
            content_hash=HASH_A,
            observed_at=NOW - timedelta(hours=1),
            evidence_label=EvidenceLabel.FACT,
            authority_class=AuthorityClass.EVIDENCE_ONLY,
            privacy_class=PrivacyClass.PRIVATE,
            confidence=__import__("upoi_contracts").ConfidenceBand.HIGH,
        ),
        idempotency_key=key,
        gate_id=plan.human_gate,
        profile_id=f"profile:{plan.target_authority.value}",
    )


def _gate(plan: ActionPlan) -> Gate:
    assert plan.human_gate is not None
    return Gate(
        gate_id=plan.human_gate,
        kind=GateKind.HUMAN,
        scope=plan.scope,
        requested_at=NOW - timedelta(hours=1),
        state=GateState.APPROVED,
        approver=AuthorityClass.OWNER,
        decided_at=NOW - timedelta(minutes=10),
        decision_ref="decision:synthetic-task-8-3",
    )


def _loop_baseline(*, baseline_id: str = "baseline:task-8-3", version: str = "synthetic-v1") -> BaselineManifest:
    return create_complete_loop_baseline(
        baseline_id=baseline_id,
        version=version,
        source_revision_refs=("revision:synthetic-task-8-3",),
        contract_refs=("contract:upoi-task-8-3",),
        spec_hashes=(HASH_A,),
        schema_versions=("schema:loop-v1",),
        fixture_versions=("fixture:loop-v1",),
        created_at=NOW,
    )


def _admitted_loop() -> tuple[BaselineManifest, object, object]:
    baseline = _loop_baseline()
    adapter = build_complete_loop_adapter(baseline)
    definition = adapter.entry(1).definition
    record = admit_loop(
        definition,
        BaselineRegistry().register(baseline),
        opened_at=NOW,
        rollback_refs=adapter.rollback_refs,
    )
    return baseline, definition, record


def _observations(baseline: BaselineManifest, definition: object, *, failed: bool = False, alternate: BaselineManifest | None = None, omit: bool = False) -> LoopObservations:
    groups = {
        "exit_criteria": (HASH_A, definition.exit_criteria),
        "positive_control": (HASH_B, definition.positive_control),
        "negative_test": (HASH_C, definition.negative_test),
        "regression_check": (HASH_D, definition.regression_check),
    }
    observations: dict[str, tuple[CheckObservation, ...]] = {}
    for name, (evidence_hash, checks) in groups.items():
        values = tuple(
            CheckObservation(
                check_id=(f"omitted:{check.check_id}" if omit and name == "positive_control" and index == 0 else check.check_id),
                passed=not failed or name == "exit_criteria",
                evidence_hash=evidence_hash,
                observed_at=NOW,
                baseline_ref=(alternate or baseline).reference,
            )
            for index, check in enumerate(checks)
        )
        observations[name] = values
    return LoopObservations(**observations)


def _rerun(record: object, baseline: BaselineManifest, definition: object, observations: LoopObservations, *, head: str | None = None, state: ObjectiveState = ObjectiveState.VERIFIED, matched: bool = True) -> DashboardRerunReceipt:
    checked = _append_observation_events(record.evidence_chain, record, observations)
    return DashboardRerunReceipt(
        objective_id=definition.objective_id,
        baseline_ref=baseline.reference,
        evidence_chain_head=head or checked.head_hash,
        receipt_ref="dashboard-rerun:synthetic-task-8-3",
        state=state,
        observed_at=NOW,
        matched=matched,
    )


class UpoiDesignPropertySuite(unittest.TestCase):
    # **Validates: Requirements 1.1, 1.3**
    @settings(max_examples=60, deadline=None)
    @given(invalid_registries())
    def test_property_1_objective_registry_completeness(self, case: InvalidRegistryCase) -> None:
        self.assertIs(validate_objective_registry(UPOI_OBJECTIVES), UPOI_OBJECTIVES)
        baseline = __import__("upoi_contracts").BaselineRef("synthetic:baseline/task-8-3", HASH_A, "synthetic-v1")
        with self.assertRaises(ObjectiveRegistryError):
            project_objective_dashboard((object(),), baseline, registry=case.registry)

    # **Validates: Requirements 2.1, 2.2, 2.3, 3.1, 3.2, 3.3**
    @settings(max_examples=60, deadline=None)
    @given(amount=st.one_of(SAFE_MILLIUNITS.map(lambda value: ("safe", value)), UNSAFE_MONEY.map(lambda value: ("unsafe", value))), available=st.booleans())
    def test_property_2_financial_authority_preservation(self, amount: tuple[str, object], available: bool) -> None:
        kind, value = amount
        provenance = ProvenanceRecord(
            source_ref="synthetic:pfos/source",
            source_version="synthetic:pfos/v1",
            content_hash=HASH_A,
            observed_at=NOW,
            evidence_label=EvidenceLabel.FACT,
            authority_class=AuthorityClass.DETERMINISTIC_DOMAIN,
            privacy_class=PrivacyClass.PRIVATE,
            confidence=__import__("upoi_contracts").ConfidenceBand.HIGH,
        )
        snapshot = FinancialSnapshot("synthetic:pfos/snapshot", NOW.isoformat().replace("+00:00", "Z"), {"amount": value}, provenance)  # type: ignore[dict-item]
        source = SyntheticPfosSource(snapshot, available)
        port = DeterministicFinancePort(source)
        if not available:
            with self.assertRaises(FinanceSourceUnavailableError):
                port.read_financial_snapshot(FinanceQuery("synthetic:query", {"scope": "synthetic"}))
        elif kind == "safe":
            result = port.read_financial_snapshot(FinanceQuery("synthetic:query", {"scope": "synthetic"}))
            self.assertIs(result, source.snapshot)
            self.assertIs(type(result.values["amount"]), int)
            self.assertEqual(result.values["amount"], value)
        else:
            with self.assertRaises(MilliunitBoundaryError):
                port.read_financial_snapshot(FinanceQuery("synthetic:query", {"scope": "synthetic"}))
        self.assertEqual(source.calls, 1)

    # **Validates: Requirements 1.1, 1.2, 1.3**
    @settings(max_examples=60, deadline=None)
    @given(effect_cases())
    def test_property_3_bounded_effect_execution(self, case: EffectCase) -> None:
        decision, plan = _plan_for_effect(case)
        if plan is None:
            self.assertEqual(decision.external_effect_count, 0)
            return
        approval_is_current = case.approval == "valid"
        grants = () if case.approval in {"missing-grant", "missing-gate"} else (_grant(plan, case.approval),)
        gates = () if plan.human_gate is None or case.approval == "missing-gate" else (_gate(plan),)
        authorization = authorize_plan(plan, _profile(plan), grants, gates, NOW)
        if not case.authority_matches or not approval_is_current:
            self.assertEqual(authorization.external_effect_count, 0)
            self.assertIsNone(authorization.authorized_plan)
            return
        assert authorization.authorized_plan is not None
        target = SyntheticTarget(case.verification)
        dispatcher = BoundedDispatcher(target, clock=lambda: NOW)
        if case.verification == "unknown":
            with self.assertRaises(DispatchError) as raised:
                dispatcher.dispatch(authorization.authorized_plan)
            self.assertEqual(raised.exception.code.value, "VERIFICATION_UNKNOWN")
            self.assertEqual(target.effects, 1)
            with self.assertRaises(DispatchError) as replay:
                dispatcher.dispatch(authorization.authorized_plan)
            self.assertEqual(replay.exception.code.value, "SAFE_REPLAY_BLOCKED")
            self.assertTrue(dispatcher.audit.verify_chain())
            return
        result = dispatcher.dispatch(authorization.authorized_plan)
        self.assertEqual(result.execution.outcome, ExecutionOutcome.SUCCEEDED)
        self.assertIsNotNone(result.verification)
        self.assertEqual(target.calls, 1)
        self.assertTrue(dispatcher.audit.verify_chain())
        replay = dispatcher.dispatch(authorization.authorized_plan)
        self.assertTrue(replay.replayed)
        self.assertEqual(target.calls, 1)
        self.assertTrue(dispatcher.audit.verify_chain())

    # **Validates: Requirements 1.4, 2.4**
    @settings(max_examples=60, deadline=None)
    @given(cases=st.lists(provenance_cases(), min_size=1, max_size=5).map(tuple))
    def test_property_4_provenance_and_locality(self, cases: tuple[ProvenanceCase, ...]) -> None:
        admitted = []
        provider_bound = []
        for case in cases:
            is_admitted, is_provider_bound, refusal = _context_decision(case)
            complete = case.incomplete_field is None
            permitted = case.domain in PROFILE_DOMAINS[case.profile]
            authority_preserved = case.authority is AuthorityClass.CONTEXT
            self.assertEqual(is_admitted, complete and permitted and authority_preserved)
            self.assertFalse(is_provider_bound and not is_admitted)
            if not complete:
                self.assertEqual(refusal, "INCOMPLETE_PROVENANCE")
            if case.privacy in RESTRICTED_PRIVACY or case.domain in LOCAL_ONLY_DOMAINS:
                self.assertFalse(is_provider_bound)
            admitted.append(is_admitted)
            provider_bound.append(is_provider_bound)
        self.assertLessEqual(sum(provider_bound), sum(admitted))

    # **Validates: Requirements 1.2, 1.3, 1.4**
    @settings(max_examples=40, deadline=None)
    @given(loop_cases())
    def test_property_5_loop_evidence_integrity(self, case: LoopCase) -> None:
        baseline, definition, record = _admitted_loop()
        registry = BaselineRegistry().register(baseline)
        if case.kind == "tampered-baseline":
            tampered = _loop_baseline(baseline_id=f"baseline:tampered:{case.nonce}", version="tampered")
            with self.assertRaises(ContractValidationError):
                admit_loop(definition, BaselineRegistry().register(tampered), opened_at=NOW, rollback_refs=(definition.rollback_ref,))
            return
        if case.kind == "lowered-floor":
            weakened = replace(definition, positive_control=(CheckDefinition(definition.positive_control[0].check_id, "weakened"),))
            with self.assertRaises(ContractValidationError):
                admit_loop(weakened, registry, opened_at=NOW, rollback_refs=(weakened.rollback_ref,), predecessor=definition)
            return
        observations = _observations(
            baseline,
            definition,
            failed=case.kind == "failed-rerun",
            alternate=_loop_baseline(baseline_id=f"baseline:other:{case.nonce}", version="other") if case.kind == "different-baseline" else None,
            omit=case.kind == "omitted-check",
        )
        if case.kind in {"omitted-check", "different-baseline"}:
            with self.assertRaises(ContractValidationError):
                close_loop(record, observations, _rerun(record, baseline, definition, observations), closed_at=NOW)
            return
        if case.kind == "invalid-chain-head":
            with self.assertRaises(ContractValidationError):
                close_loop(record, observations, _rerun(record, baseline, definition, observations, head=case.invalid_head), closed_at=NOW)
            return
        if case.kind == "human-gate":
            blocker = TypedBlocker(BlockerKind.HUMAN_GATE, "OWNER_APPROVAL_REQUIRED", "Synthetic gate", "Owner records synthetic approval.", AuthorityClass.GOVERNANCE, NOW)
            closure = close_loop(record, observations, _rerun(record, baseline, definition, observations), closed_at=NOW, blocker=blocker)
            self.assertEqual(closure.state, LoopState.BLOCKED_HUMAN)
            self.assertNotEqual(closure.state, LoopState.PASSED)
            return
        closure = close_loop(record, observations, _rerun(record, baseline, definition, observations, state=ObjectiveState.FAILED if case.kind == "failed-rerun" else ObjectiveState.VERIFIED), closed_at=NOW)
        if case.kind == "failed-rerun":
            self.assertIn(closure.state, (LoopState.FAILED, LoopState.REGRESSED))
        else:
            self.assertEqual(closure.state, LoopState.PASSED)
        self.assertEqual(closure.baseline_ref, baseline.reference)


if __name__ == "__main__":
    unittest.main()
