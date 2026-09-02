"""
NIZAM · PFOS/browser milliunit boundary and envelope parity tests
Owning contract: UPOI requirements 3.1–3.4; design §7.5, §11.1, §14.3
Phase: UPOI task 3.4

Synthetic offline tests only. The shared fixture is consumed by the browser and
server suites to prove exact EGP milliunit boundaries without a second calculator.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from typing import Any

from src.server.pfos_port import (
    MAX_SAFE_MILLIUNITS,
    MilliunitBoundaryError,
    SignedFlow,
    parse_milliunit_envelope,
    parse_milliunits,
    serialize_milliunit_envelope,
    serialize_signed_flow,
)


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "pfos-money-boundary.json"
FIXTURE: dict[str, Any] = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


class PfosBoundaryParityTests(unittest.TestCase):
    def test_fixture_declares_exact_egp_boundary_and_safe_edges(self) -> None:
        self.assertEqual(FIXTURE["currency"], "EGP")
        self.assertEqual(FIXTURE["milliunitsPerEgp"], 1000)
        self.assertEqual(FIXTURE["safeEdges"]["minimum"], str(-MAX_SAFE_MILLIUNITS))
        self.assertEqual(FIXTURE["safeEdges"]["maximum"], str(MAX_SAFE_MILLIUNITS))
        self.assertEqual(parse_milliunits(FIXTURE["envelopeValues"]["oneEgp"]), 1000)

    def test_server_envelope_matches_shared_browser_fixture_exactly(self) -> None:
        values = FIXTURE["envelopeValues"]

        payload = serialize_milliunit_envelope(
            {key: int(value) for key, value in values.items()}
        )

        self.assertEqual(payload, FIXTURE["envelope"])
        self.assertEqual(
            parse_milliunit_envelope(payload),
            {key: int(value) for key, value in values.items()},
        )
        self.assertEqual(
            serialize_milliunit_envelope(parse_milliunit_envelope(payload)),
            payload,
        )

    def test_signed_flow_fixtures_preserve_sign_and_magnitude_conventions(self) -> None:
        for fixture in FIXTURE["signedFlows"]:
            flow = SignedFlow(
                amount=int(fixture["amount"]),
                outflow=int(fixture["outflow"]),
                inflow=int(fixture["inflow"]),
            )
            self.assertEqual(serialize_signed_flow(flow), fixture["wire"])
            self.assertEqual(parse_milliunit_envelope(fixture["wire"])["amount"], flow.amount)

    def test_invalid_input_is_rejected_before_calculation_or_persistence(self) -> None:
        calls: list[str] = []

        def calculate_and_persist(raw: str) -> None:
            value = parse_milliunits(raw)
            calls.append("calculate")
            calls.append("persist")
            self.assertTrue(isinstance(value, int))

        for raw in FIXTURE["invalidMilliunitText"]:
            with self.subTest(raw=raw):
                with self.assertRaises(MilliunitBoundaryError):
                    calculate_and_persist(raw)
                self.assertEqual(calls, [])

    def test_server_parser_rejects_noncanonical_integer_text(self) -> None:
        for raw in (" 1000", "+1000", "01"):
            with self.subTest(raw=raw):
                with self.assertRaises(MilliunitBoundaryError):
                    parse_milliunits(raw)

    def test_safe_edges_round_trip_without_loss_or_float_conversion(self) -> None:
        for raw in (
            FIXTURE["safeEdges"]["minimum"],
            "0",
            FIXTURE["safeEdges"]["maximum"],
        ):
            with self.subTest(raw=raw):
                value = parse_milliunits(raw)
                self.assertEqual(str(value), raw)


if __name__ == "__main__":
    unittest.main()
