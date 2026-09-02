"""
NIZAM · PFOS financial authority preservation property test
Owning contract: UPOI requirements 2.1–2.3, 3.1–3.3; design §7.5, §24.2
Phase: UPOI task 3.5

Synthetic offline property tests only. Generated monetary inputs cross the existing
PFOS adapter boundary; no formula, provider, alternate writer, or live dependency
is introduced by this test.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from hypothesis import given, settings, strategies as st

from src.server.pfos_port import (
    MAX_SAFE_MILLIUNITS,
    DeterministicFinancePort,
    FinanceQuery,
    FinanceSourceUnavailableError,
    FinancialSnapshot,
    MilliunitBoundaryError,
    ProvenanceRecord,
)


QUERY = FinanceQuery(query_ref="synthetic:query/authority-property", filters={"scope": "synthetic"})
PROVENANCE = ProvenanceRecord(
    source_ref="synthetic:pfos/source",
    source_version="synthetic:pfos/v1",
    observed_at="2026-01-01T00:00:00Z",
    content_hash="synthetic-pfos-content-hash",
)


@dataclass
class SyntheticPfosSource:
    """A deterministic fixture that can only return its prebuilt PFOS snapshot."""

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


safe_milliunits = st.integers(
    min_value=-MAX_SAFE_MILLIUNITS,
    max_value=MAX_SAFE_MILLIUNITS,
)
unsafe_monetary_inputs = st.one_of(
    st.integers(min_value=MAX_SAFE_MILLIUNITS + 1, max_value=MAX_SAFE_MILLIUNITS + 1000),
    st.integers(min_value=-MAX_SAFE_MILLIUNITS - 1000, max_value=-MAX_SAFE_MILLIUNITS - 1),
    st.floats(allow_nan=False, allow_infinity=False, width=64),
    st.booleans(),
    st.sampled_from(("1000", "1.5", "9007199254740992")),
)
monetary_inputs = st.one_of(
    safe_milliunits.map(lambda value: ("safe", value)),
    unsafe_monetary_inputs.map(lambda value: ("unsafe", value)),
)


@settings(max_examples=80, deadline=None)
@given(monetary_input=monetary_inputs, pfos_available=st.booleans())
def test_only_available_pfos_safe_integers_can_be_authoritative(
    monetary_input: tuple[str, object],
    pfos_available: bool,
) -> None:
    """**Validates: Requirements 2.1, 2.2, 2.3, 3.1, 3.2, 3.3**"""

    input_kind, amount = monetary_input
    snapshot = FinancialSnapshot(
        version_ref="synthetic:pfos/snapshot/authority-property",
        observed_at="2026-01-01T00:00:00Z",
        values={"amount": amount},  # type: ignore[dict-item]
        provenance=PROVENANCE,
    )
    source = SyntheticPfosSource(snapshot=snapshot, available=pfos_available)
    port = DeterministicFinancePort(source)

    if not pfos_available:
        try:
            port.read_financial_snapshot(QUERY)
        except FinanceSourceUnavailableError as error:
            assert error.code == "PFOS_SOURCE_UNAVAILABLE"
            assert error.operation == "read_financial_snapshot"
        else:
            raise AssertionError("unavailable PFOS produced a substitute financial result")
        assert source.calls == 1
        return

    if input_kind == "safe":
        result = port.read_financial_snapshot(QUERY)

        # Accepted authority must be the exact PFOS-produced object and value.
        assert result is source.snapshot
        assert result.provenance is PROVENANCE
        assert type(result.values["amount"]) is int
        assert result.values["amount"] == amount
        assert source.calls == 1
        return

    try:
        port.read_financial_snapshot(QUERY)
    except MilliunitBoundaryError as error:
        assert error.field == "snapshot.values.amount"
        assert error.code in {
            "MILLIUNITS_FLOAT_FORBIDDEN",
            "MILLIUNITS_NOT_INTEGER",
            "MILLIUNITS_OUT_OF_SAFE_RANGE",
        }
    else:
        raise AssertionError("unsafe monetary input crossed the PFOS authority boundary")
    assert source.calls == 1


if __name__ == "__main__":
    import pytest

    raise SystemExit(pytest.main([__file__]))
