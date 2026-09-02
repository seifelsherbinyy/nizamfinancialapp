"""
NIZAM · PFOS integer-milliunit boundary and serialization tests
Owning contract: UPOI requirements 2.1–2.3, 3.1–3.3; design §6.2, §7.5, §11.1
Phase: UPOI task 3.2

Synthetic offline tests only. These tests prove that the PFOS port validates and
serializes values without arithmetic, alternate writers, provider access, or secrets.
"""

from __future__ import annotations

import unittest

from src.server.pfos_port import (
    MAX_SAFE_MILLIUNITS,
    DeterministicFinancePort,
    FinancialSnapshot,
    FinanceQuery,
    MilliunitBoundaryError,
    ProvenanceRecord,
    SignedFlow,
    deserialize_financial_snapshot,
    parse_milliunit_envelope,
    parse_milliunits,
    parse_signed_flow,
    serialize_financial_snapshot,
    serialize_milliunit_envelope,
    serialize_signed_flow,
    validate_milliunits,
)


PROVENANCE = ProvenanceRecord(
    source_ref="synthetic-pfos-source",
    source_version="synthetic-pfos-version",
    observed_at="2026-01-01T00:00:00Z",
    content_hash="synthetic-content-hash",
)
SNAPSHOT = FinancialSnapshot(
    version_ref="synthetic-snapshot-version",
    observed_at="2026-01-01T00:00:00Z",
    values={"balance": -125, "one_egp": 1000},
    provenance=PROVENANCE,
)


def refusal(callable_obj, *args, **kwargs):
    with unittest.TestCase().assertRaises(MilliunitBoundaryError) as raised:
        callable_obj(*args, **kwargs)
    return raised.exception


class MilliunitBoundaryTests(unittest.TestCase):
    def test_accepts_only_safe_integer_milliunits(self) -> None:
        self.assertEqual(validate_milliunits(-MAX_SAFE_MILLIUNITS), -MAX_SAFE_MILLIUNITS)
        self.assertEqual(validate_milliunits(MAX_SAFE_MILLIUNITS), MAX_SAFE_MILLIUNITS)
        self.assertEqual(refusal(validate_milliunits, MAX_SAFE_MILLIUNITS + 1).code, "MILLIUNITS_OUT_OF_SAFE_RANGE")
        self.assertEqual(refusal(validate_milliunits, 1.0).code, "MILLIUNITS_FLOAT_FORBIDDEN")
        self.assertEqual(refusal(validate_milliunits, True).code, "MILLIUNITS_NOT_INTEGER")

    def test_machine_parser_refuses_lossy_integer_text(self) -> None:
        self.assertEqual(parse_milliunits("-125"), -125)
        self.assertEqual(parse_milliunits("1000"), 1000)
        for value in (" 1000", "+1000", "01", "1.0", "1e3", 1.0, True, None):
            self.assertEqual(refusal(parse_milliunits, value).code, "MILLIUNITS_TEXT_INVALID")

    def test_envelope_serialization_is_exact_and_round_trips_every_boundary(self) -> None:
        payload = serialize_milliunit_envelope(
            {"inflow": 1000, "amount": -125, "boundary": MAX_SAFE_MILLIUNITS}
        )
        self.assertEqual(
            payload,
            '{"amount":"-125","boundary":"9007199254740991","inflow":"1000"}',
        )
        self.assertEqual(parse_milliunit_envelope(payload), {
            "amount": -125,
            "boundary": MAX_SAFE_MILLIUNITS,
            "inflow": 1000,
        })

    def test_signed_flow_preserves_amount_sign_and_magnitude_columns(self) -> None:
        outflow = SignedFlow(amount=-125, outflow=125, inflow=0)
        inflow = SignedFlow(amount=1000, outflow=0, inflow=1000)
        self.assertEqual(parse_signed_flow(serialize_signed_flow(outflow)), outflow)
        self.assertEqual(parse_signed_flow(serialize_signed_flow(inflow)), inflow)
        self.assertEqual(SignedFlow(amount=0, outflow=0, inflow=0).amount, 0)
        self.assertEqual(refusal(SignedFlow, amount=-125, outflow=0, inflow=125).code, "SIGNED_FLOW_CONVENTION_MISMATCH")
        self.assertEqual(refusal(SignedFlow, amount=125, outflow=-125, inflow=0).code, "SIGNED_FLOW_MAGNITUDE_NEGATIVE")

    def test_snapshot_serialization_is_exact_and_preserves_provenance(self) -> None:
        payload = serialize_financial_snapshot(SNAPSHOT)
        self.assertEqual(
            payload,
            '{"observed_at":"2026-01-01T00:00:00Z","provenance":{"content_hash":"synthetic-content-hash","observed_at":"2026-01-01T00:00:00Z","source_ref":"synthetic-pfos-source","source_version":"synthetic-pfos-version"},"values":{"balance":"-125","one_egp":"1000"},"version_ref":"synthetic-snapshot-version"}',
        )
        restored = deserialize_financial_snapshot(payload)
        self.assertEqual(restored, SNAPSHOT)
        self.assertIsNot(restored.values, SNAPSHOT.values)

    def test_parsing_fails_closed_on_float_duplicate_nonfinite_and_wrong_shapes(self) -> None:
        self.assertEqual(refusal(parse_milliunit_envelope, '{"amount":1.5}').code, "MILLIUNITS_TEXT_INVALID")
        self.assertEqual(refusal(parse_milliunit_envelope, '{"amount":1,"amount":2}').code, "JSON_DUPLICATE_KEY")
        self.assertEqual(refusal(parse_milliunit_envelope, '{"amount":NaN}').code, "JSON_NON_FINITE_NUMBER")
        self.assertEqual(refusal(parse_milliunit_envelope, '[]').code, "JSON_ENVELOPE_INVALID")

    def test_port_refuses_invalid_pf_os_snapshot_before_returning_it(self) -> None:
        class InvalidSource:
            def read_financial_snapshot(self, query: FinanceQuery) -> FinancialSnapshot:
                del query
                return FinancialSnapshot(
                    version_ref="synthetic",
                    observed_at="2026-01-01T00:00:00Z",
                    values={"balance": 1.5},  # type: ignore[dict-item]
                    provenance=PROVENANCE,
                )

            def evaluate_decision(self, request):
                del request
                raise AssertionError("not used")

        with self.assertRaises(MilliunitBoundaryError) as raised:
            DeterministicFinancePort(InvalidSource()).read_financial_snapshot(
                FinanceQuery(query_ref="synthetic", filters={})
            )
        self.assertEqual(raised.exception.code, "MILLIUNITS_FLOAT_FORBIDDEN")


if __name__ == "__main__":
    unittest.main()
