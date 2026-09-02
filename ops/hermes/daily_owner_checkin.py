#!/usr/bin/env python3
"""Generate a short owner check-in from approved, non-sensitive context.

This script is intentionally deterministic and does not call a model. It reads only
confirmed owner preferences and cloud-allowed evidence, never raw journal, health,
Whoop, account rows, credentials, or deployment particulars.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path


SECRET_PATTERN = re.compile(r"sk-or-|private key|api[_-]?key|token|secret", re.IGNORECASE)
PRIVATE_PATTERN = re.compile(r"journal|health|whoop|therapy|medical|diagnos", re.IGNORECASE)


def _read_confirmed_memory(path: Path) -> list[str]:
    if not path.is_absolute() or not path.is_file():
        return []
    values: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            item = json.loads(line)
        except ValueError:
            continue
        value = str(item.get("content", "")).strip()
        if (
            item.get("status") == "confirmed"
            and item.get("confirmed_by") == "Operator"
            and value
            and not SECRET_PATTERN.search(value)
            and not PRIVATE_PATTERN.search(value)
        ):
            values.append(value)
    return values


def _read_evidence_labels(path: Path) -> list[str]:
    if not path.is_absolute() or not path.is_file():
        return []
    try:
        packet = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    labels: list[str] = []
    for item in packet.get("evidence", []) if isinstance(packet, dict) else []:
        if not isinstance(item, dict):
            continue
        label = str(item.get("sourceLabel", "")).strip()
        if (
            item.get("privacyClass") == "cloud_allowed"
            and item.get("domain") not in {"journal", "health"}
            and label
            and not SECRET_PATTERN.search(label)
            and not PRIVATE_PATTERN.search(label)
        ):
            labels.append(label)
    return labels


def build_message(memory_path: str, evidence_path: str) -> str:
    memory = _read_confirmed_memory(Path(memory_path).expanduser())
    labels = _read_evidence_labels(Path(evidence_path).expanduser())
    project_context = any("nizam" in value.lower() or "pfos" in value.lower() for value in memory)
    finance_context = any(
        any(term in label.lower() for term in ("financial", "banking", "ledger", "pfos"))
        for label in labels
    )

    if project_context and finance_context:
        context = "I'm keeping the NIZAM work aligned with your approved plans and validated financial sources."
    elif project_context:
        context = "I'm keeping today's NIZAM check-in aligned with the approved project context."
    elif finance_context:
        context = "I'm keeping today's check-in aligned with the validated financial context."
    else:
        context = "I'm here for a calm, focused start to your day."

    return f"Good morning. {context} What is the one thing you want to protect or accomplish today?"


if __name__ == "__main__":
    print(
        build_message(
            os.environ.get("NIZAM_HERMES_MEMORY_FILE", ""),
            os.environ.get("NIZAM_HERMES_EVIDENCE_FILE", ""),
        )
    )
