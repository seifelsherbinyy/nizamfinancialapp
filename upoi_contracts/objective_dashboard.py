"""Read-only UPOI objective registry, evaluation model, and dashboard projection.

Owning contract: UPOI task 7.1; requirements 1.3, 1.4, 2.1, 3.3;
design sections 7.2, 10, and 10.1.

This module is an immutable offline read model. It has no persistence, network,
provider, finance, life, signal, queue, Drive, or runtime-state capability. PFOS
remains the only source of authoritative financial facts.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
import re
from types import MappingProxyType
from typing import Mapping, Sequence

from .models import (
    AuthorityClass,
    BaselineRef,
    CheckDefinition,
    ContractValidationError,
    EvidenceContract,
    EvidenceLabel,
    ObjectiveEvaluation,
    ObjectiveState,
)


class ObjectiveRegistryError(ContractValidationError):
    """Raised when the canonical twenty-objective registry is not valid."""


class EvidenceTemporal(str, Enum):
    CURRENT_BASELINE = "CURRENT_BASELINE"
    HISTORICAL = "HISTORICAL"


# Explicitly documents the dashboard's deny-by-construction boundary. The set is
# intentionally not an API for writes; it is used by tests and reviewers to make
# the prohibited destinations visible without importing any store implementation.
DASHBOARD_PROHIBITED_WRITE_TARGETS = frozenset(
    {"finance", "life", "signal", "queue", "Drive", "runtime"}
)


_QUESTION_PUNCTUATION = re.compile(r"[^\w\s]")


def _normalized_words(question: str) -> tuple[str, ...]:
    return tuple(
        word
        for word in _QUESTION_PUNCTUATION.sub("", question).split()
        if word
    )


def _non_empty_tuple(values: object, field: str) -> tuple[object, ...]:
    if not isinstance(values, tuple) or not values:
        raise ObjectiveRegistryError(f"{field} must be a non-empty tuple")
    return values


@dataclass(frozen=True, slots=True)
class ObjectiveRegistryEntry:
    """One immutable entry in the only dashboard objective registry."""

    id: int
    slug: str
    name: str
    validation_question: str
    owner: AuthorityClass
    evidence_contract: EvidenceContract
    positive_checks: tuple[CheckDefinition, ...]
    negative_checks: tuple[CheckDefinition, ...]
    regression_checks: tuple[CheckDefinition, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.id, int) or isinstance(self.id, bool) or self.id <= 0:
            raise ObjectiveRegistryError("objective id must be a positive integer")
        for field in ("slug", "name", "validation_question"):
            value = getattr(self, field)
            if not isinstance(value, str) or not value.strip():
                raise ObjectiveRegistryError(f"{field} must be a non-empty string")
        if not isinstance(self.owner, AuthorityClass):
            raise ObjectiveRegistryError("owner must be an AuthorityClass")
        if not isinstance(self.evidence_contract, EvidenceContract):
            raise ObjectiveRegistryError("evidence_contract must be an EvidenceContract")
        if len(_normalized_words(self.validation_question)) != 5:
            raise ObjectiveRegistryError(
                "validation_question must contain exactly five normalized words"
            )
        for field in ("positive_checks", "negative_checks", "regression_checks"):
            checks = _non_empty_tuple(getattr(self, field), field)
            if not all(isinstance(check, CheckDefinition) for check in checks):
                raise ObjectiveRegistryError(f"{field} must contain CheckDefinition values")
            if len({check.check_id for check in checks}) != len(checks):
                raise ObjectiveRegistryError(f"{field} must not contain duplicate check ids")


@dataclass(frozen=True, slots=True)
class EvidenceProjection:
    """Evidence displayed by the dashboard without changing its source record."""

    reference: str
    baseline_ref: BaselineRef
    observed_at: datetime
    temporal: EvidenceTemporal
    labels: tuple[EvidenceLabel, ...] = ()

    def __post_init__(self) -> None:
        if not isinstance(self.reference, str) or not self.reference.strip():
            raise ObjectiveRegistryError("evidence reference must be non-empty")
        if not isinstance(self.baseline_ref, BaselineRef):
            raise ObjectiveRegistryError("evidence baseline_ref must be a BaselineRef")
        if not isinstance(self.observed_at, datetime) or self.observed_at.tzinfo is None:
            raise ObjectiveRegistryError("evidence observed_at must be timezone-aware")
        if not isinstance(self.temporal, EvidenceTemporal):
            raise ObjectiveRegistryError("evidence temporal must be EvidenceTemporal")
        if not isinstance(self.labels, tuple) or not all(
            isinstance(label, EvidenceLabel) for label in self.labels
        ):
            raise ObjectiveRegistryError("evidence labels must contain EvidenceLabel values")


@dataclass(frozen=True, slots=True)
class ObjectiveDashboardCard:
    """A single immutable card projected from the validated registry and evidence."""

    definition: ObjectiveRegistryEntry
    current_evaluation: ObjectiveEvaluation | None
    historical_evaluations: tuple[ObjectiveEvaluation, ...]
    current_evidence: tuple[EvidenceProjection, ...]
    historical_evidence: tuple[EvidenceProjection, ...]

    @property
    def state(self) -> ObjectiveState:
        return self.current_evaluation.state if self.current_evaluation else ObjectiveState.UNKNOWN

    @property
    def status_label(self) -> str:
        # Keep blocked, failed, and regressed values verbatim so a renderer cannot
        # collapse them into a generic incomplete/completed presentation.
        return self.state.value

    @property
    def is_completion(self) -> bool:
        return self.state is ObjectiveState.VERIFIED

    @property
    def is_blocked(self) -> bool:
        return self.state in {
            ObjectiveState.BLOCKED_HUMAN,
            ObjectiveState.BLOCKED_DEPENDENCY,
        }


@dataclass(frozen=True, slots=True)
class ObjectiveDashboardProjection:
    """The complete twenty-card read model; no mutation methods are exposed."""

    baseline_ref: BaselineRef
    cards: tuple[ObjectiveDashboardCard, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.baseline_ref, BaselineRef):
            raise ObjectiveRegistryError("projection baseline_ref must be a BaselineRef")
        if not isinstance(self.cards, tuple) or len(self.cards) != 20:
            raise ObjectiveRegistryError("dashboard projection must contain exactly twenty cards")
        ids = tuple(card.definition.id for card in self.cards)
        if ids != tuple(range(1, 21)):
            raise ObjectiveRegistryError("dashboard cards must preserve registry order")

    @property
    def status_counts(self) -> Mapping[str, int]:
        counts: dict[str, int] = {}
        for card in self.cards:
            counts[card.status_label] = counts.get(card.status_label, 0) + 1
        return MappingProxyType(counts)


_CANONICAL_ROWS: tuple[tuple[int, str, str, str, AuthorityClass], ...] = (
    (1, "build-persistent-personal-operating-intelligence", "Build Persistent Personal Operating Intelligence", "Does NIZAM operate continuously autonomously?", AuthorityClass.GOVERNANCE),
    (2, "maintain-continuous-agent-memory", "Maintain Continuous Agent Memory", "Does NIZAM remember relevant history?", AuthorityClass.CONTEXT),
    (3, "transform-thoughts-into-intelligence", "Transform Thoughts Into Intelligence", "Are thoughts becoming useful intelligence?", AuthorityClass.CONTEXT),
    (4, "turn-goals-into-execution", "Turn Goals Into Execution", "Are goals becoming completed actions?", AuthorityClass.GOVERNANCE),
    (5, "prioritize-recovery-under-constraints", "Prioritize Recovery Under Constraints", "Does NIZAM protect depleted capacity?", AuthorityClass.GOVERNANCE),
    (6, "improve-decision-quality", "Improve Decision Quality", "Are my decisions becoming better?", AuthorityClass.GOVERNANCE),
    (7, "challenge-assumptions-before-action", "Challenge Assumptions Before Action", "Are weak assumptions challenged early?", AuthorityClass.GOVERNANCE),
    (8, "convert-problems-into-plans", "Convert Problems Into Plans", "Do problems produce executable plans?", AuthorityClass.GOVERNANCE),
    (9, "track-decisions-and-learning", "Track Decisions And Learning", "Does NIZAM learn from outcomes?", AuthorityClass.EVIDENCE_ONLY),
    (10, "operate-mal-pfos-financial-intelligence", "Operate MAL/PFOS Financial Intelligence", "Is MAL improving financial outcomes?", AuthorityClass.DETERMINISTIC_DOMAIN),
    (11, "optimize-health-and-energy", "Optimize Health And Energy", "Is NIZAM improving daily capacity?", AuthorityClass.CONTEXT),
    (12, "detect-behavioral-and-psyche-patterns", "Detect Behavioral And Psyche Patterns", "Does NIZAM understand my patterns?", AuthorityClass.CONTEXT),
    (13, "reduce-impulsive-decisions", "Reduce Impulsive Decisions", "Are harmful impulses increasingly interrupted?", AuthorityClass.DETERMINISTIC_DOMAIN),
    (14, "maintain-faith-and-values-alignment", "Maintain Faith And Values Alignment", "Are actions aligned with values?", AuthorityClass.OWNER),
    (15, "increase-professional-leverage", "Increase Professional Leverage", "Is professional leverage measurably increasing?", AuthorityClass.OWNER),
    (16, "automate-life-administration", "Automate Life Administration", "Is manual administration consistently decreasing?", AuthorityClass.EXECUTION_RUNTIME),
    (17, "coordinate-specialized-agent-personas", "Coordinate Specialized Agent Personas", "Do agents collaborate without confusion?", AuthorityClass.GOVERNANCE),
    (18, "anticipate-risks-and-opportunities", "Anticipate Risks And Opportunities", "Does NIZAM act before problems?", AuthorityClass.GOVERNANCE),
    (19, "continuously-improve-agent-intelligence", "Continuously Improve Agent Intelligence", "Is NIZAM improving through usage?", AuthorityClass.EVIDENCE_ONLY),
    (20, "compound-personal-autonomy", "Compound Personal Autonomy", "Am I becoming more autonomous?", AuthorityClass.OWNER),
)


def _make_entry(row: tuple[int, str, str, str, AuthorityClass]) -> ObjectiveRegistryEntry:
    objective_id, slug, name, question, owner = row
    prefix = f"UPOI-L{objective_id:02d}"
    return ObjectiveRegistryEntry(
        id=objective_id,
        slug=slug,
        name=name,
        validation_question=question,
        owner=owner,
        evidence_contract=EvidenceContract(
            contract_ref=f"contract:{prefix.lower()}",
            requirement_refs=("requirement:1.3", "requirement:1.4"),
        ),
        positive_checks=(CheckDefinition(f"{prefix}:positive", "positive control"),),
        negative_checks=(CheckDefinition(f"{prefix}:negative", "negative test"),),
        regression_checks=(CheckDefinition(f"{prefix}:regression", "regression check"),),
    )


UPOI_OBJECTIVES: tuple[ObjectiveRegistryEntry, ...] = tuple(_make_entry(row) for row in _CANONICAL_ROWS)


def validate_objective_registry(
    objectives: Sequence[ObjectiveRegistryEntry],
) -> tuple[ObjectiveRegistryEntry, ...]:
    """Validate and freeze the only registry accepted by the read model."""

    if not isinstance(objectives, (tuple, list)):
        raise ObjectiveRegistryError("objectives must be a tuple or list")
    candidate = tuple(objectives)
    if len(candidate) != 20:
        raise ObjectiveRegistryError("registry must contain exactly twenty objectives")
    if not all(isinstance(item, ObjectiveRegistryEntry) for item in candidate):
        raise ObjectiveRegistryError("registry must contain ObjectiveRegistryEntry values")
    ids = tuple(item.id for item in candidate)
    slugs = tuple(item.slug for item in candidate)
    if ids != tuple(range(1, 21)):
        raise ObjectiveRegistryError("registry ids must be ordered 1 through 20")
    if len(set(ids)) != 20 or len(set(slugs)) != 20:
        raise ObjectiveRegistryError("registry ids and slugs must be unique")
    for actual, expected in zip(candidate, UPOI_OBJECTIVES):
        if actual != expected:
            raise ObjectiveRegistryError("registry differs from the canonical objective set")
        if len(_normalized_words(actual.validation_question)) != 5:
            raise ObjectiveRegistryError("objective question must normalize to five words")
    return candidate


def validated_objective_registry() -> tuple[ObjectiveRegistryEntry, ...]:
    """Return the canonical registry only after validating it at the boundary."""

    return validate_objective_registry(UPOI_OBJECTIVES)


def _evidence_for(
    evaluation: ObjectiveEvaluation,
    temporal: EvidenceTemporal,
) -> tuple[EvidenceProjection, ...]:
    labels = tuple(finding.label for finding in evaluation.findings)
    return tuple(
        EvidenceProjection(
            reference=reference,
            baseline_ref=evaluation.baseline_ref,
            observed_at=evaluation.evaluated_at,
            temporal=temporal,
            labels=labels,
        )
        for reference in evaluation.evidence_refs
    )


def project_objective_dashboard(
    evaluations: Sequence[ObjectiveEvaluation],
    current_baseline: BaselineRef,
    *,
    registry: Sequence[ObjectiveRegistryEntry] = UPOI_OBJECTIVES,
) -> ObjectiveDashboardProjection:
    """Project evaluations into twenty cards without writing any source state.

    Evaluations on ``current_baseline`` are current evidence. Evaluations on any
    other immutable baseline remain historical and cannot satisfy current status.
    Duplicate current evaluations are rejected rather than silently selected.
    """

    validated = validate_objective_registry(registry)
    if not isinstance(current_baseline, BaselineRef):
        raise ObjectiveRegistryError("current_baseline must be a BaselineRef")
    if not isinstance(evaluations, (tuple, list)):
        raise ObjectiveRegistryError("evaluations must be a tuple or list")
    by_id: dict[int, list[ObjectiveEvaluation]] = {entry.id: [] for entry in validated}
    for evaluation in evaluations:
        if not isinstance(evaluation, ObjectiveEvaluation):
            raise ObjectiveRegistryError("evaluations must contain ObjectiveEvaluation values")
        if evaluation.objective_id not in by_id:
            raise ObjectiveRegistryError("evaluation references an objective outside the registry")
        by_id[evaluation.objective_id].append(evaluation)

    cards: list[ObjectiveDashboardCard] = []
    for entry in validated:
        current = [item for item in by_id[entry.id] if item.baseline_ref == current_baseline]
        historical = [item for item in by_id[entry.id] if item.baseline_ref != current_baseline]
        if len(current) > 1:
            raise ObjectiveRegistryError("an objective cannot have duplicate current evaluations")
        current_evaluation = current[0] if current else None
        cards.append(
            ObjectiveDashboardCard(
                definition=entry,
                current_evaluation=current_evaluation,
                historical_evaluations=tuple(historical),
                current_evidence=_evidence_for(current_evaluation, EvidenceTemporal.CURRENT_BASELINE) if current_evaluation else (),
                historical_evidence=tuple(
                    evidence
                    for item in historical
                    for evidence in _evidence_for(item, EvidenceTemporal.HISTORICAL)
                ),
            )
        )
    return ObjectiveDashboardProjection(current_baseline, tuple(cards))


__all__ = [
    "DASHBOARD_PROHIBITED_WRITE_TARGETS",
    "EvidenceProjection",
    "EvidenceTemporal",
    "ObjectiveDashboardCard",
    "ObjectiveDashboardProjection",
    "ObjectiveRegistryEntry",
    "ObjectiveRegistryError",
    "UPOI_OBJECTIVES",
    "project_objective_dashboard",
    "validate_objective_registry",
    "validated_objective_registry",
]
