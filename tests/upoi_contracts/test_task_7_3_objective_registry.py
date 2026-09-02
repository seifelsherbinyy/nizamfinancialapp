"""Property checks for UPOI task 7.3 objective registry completeness.

Owning contract: UPOI task 7.3; requirements 1.1 and 1.3; design Property 1.
Phase: offline dashboard verification. Synthetic-only: no providers, network,
secrets, deployment, persistence, or external effects.
"""

from __future__ import annotations

from typing import NamedTuple
import unittest

from hypothesis import given, settings, strategies as st
from hypothesis.strategies import composite

from upoi_contracts import (
    BaselineRef,
    ObjectiveRegistryError,
    UPOI_OBJECTIVES,
    project_objective_dashboard,
    validate_objective_registry,
)


class InvalidRegistryCase(NamedTuple):
    mutation: str
    registry: tuple[object, ...]


@composite
def invalid_registries(draw) -> InvalidRegistryCase:
    """Generate each specified malformed form from the one canonical registry."""

    mutation = draw(st.sampled_from(("missing", "duplicate", "reordered", "reworded")))
    candidate = list(UPOI_OBJECTIVES)

    if mutation == "missing":
        del candidate[draw(st.integers(min_value=0, max_value=len(candidate) - 1))]
    elif mutation == "duplicate":
        source_index = draw(st.integers(min_value=0, max_value=len(candidate) - 1))
        target_offset = draw(st.integers(min_value=1, max_value=len(candidate) - 1))
        target_index = (source_index + target_offset) % len(candidate)
        candidate[target_index] = candidate[source_index]
    elif mutation == "reordered":
        first_index = draw(st.integers(min_value=0, max_value=len(candidate) - 2))
        candidate[first_index], candidate[first_index + 1] = (
            candidate[first_index + 1],
            candidate[first_index],
        )
    else:
        index = draw(st.integers(min_value=0, max_value=len(candidate) - 1))
        candidate[index] = candidate[index].__class__(
            id=candidate[index].id,
            slug=candidate[index].slug,
            name=candidate[index].name,
            validation_question="Am I becoming truly autonomous?",
            owner=candidate[index].owner,
            evidence_contract=candidate[index].evidence_contract,
            positive_checks=candidate[index].positive_checks,
            negative_checks=candidate[index].negative_checks,
            regression_checks=candidate[index].regression_checks,
        )

    return InvalidRegistryCase(mutation, tuple(candidate))


class ObjectiveRegistryCompletenessPropertyTests(unittest.TestCase):
    # **Validates: Requirements 1.1, 1.3**
    @settings(max_examples=120, deadline=None)
    @given(invalid_registries())
    def test_property_objective_registry_completeness(self, case: InvalidRegistryCase) -> None:
        """Every generated registry defect is refused before dashboard evaluation."""
        self.assertIs(validate_objective_registry(UPOI_OBJECTIVES), UPOI_OBJECTIVES)

        baseline = BaselineRef("synthetic:baseline/task-7-3", "a" * 64, "synthetic-v1")
        with self.assertRaises(ObjectiveRegistryError) as raised:
            # The invalid evaluation value must never be inspected: registry validation
            # is the dashboard's first fail-closed boundary.
            project_objective_dashboard(
                (object(),),
                baseline,
                registry=case.registry,
            )

        self.assertIn("registry", str(raised.exception).lower())
        self.assertIn(case.mutation, {"missing", "duplicate", "reordered", "reworded"})


if __name__ == "__main__":
    unittest.main()
