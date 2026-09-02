# Requirements Document

## Introduction

This document is a **DRAFT pending design review**. It derives governed UPOI behavior from `design.md`. It is documentation only and authorizes no production, deployment, network, secret, provider, Drive, Telegram, host, commit, or push action. NIZAM governs; PFOS is deterministic financial authority; Hermes executes bounded grants; Telegram is an operator interface; provenance context is non-authoritative; Drive is a narrow archive; VPS is persistent compute.

## Glossary

| Term | Meaning |
|---|---|
| NIZAM | Governing Personal Operating Intelligence layer. |
| MAL/PFOS | One unified deterministic financial subsystem; PFOS is canonical during migration. |
| Hermes | Bounded execution runtime for explicitly granted tools and workflows. |
| Provenance context | Retrieved knowledge with source, version, hash, time, sensitivity, and authority metadata. |
| Loop | A bounded inspect-to-verify cycle with immutable baseline, positive control, negative test, regression check, and rollback. |

## Requirements

### Requirement 1: Governed Authority Resolution

**User Story:** As the owner, I want every requested action resolved against explicit authority so that unified operation does not collapse domain boundaries.

#### Acceptance Criteria
1. WHEN an operator turn is accepted, THE Governance Plane SHALL classify its intent, target authority, risk, required grants, and applicable human gate before dispatch.
2. IF no accepted authority rule covers a requested action, THEN THE Governance Plane SHALL refuse the action or request bounded clarification without causing an external effect.
3. WHEN a plan is dispatched, THE Governance Plane SHALL retain traceability from the governing contract and requirement to the execution and verification receipts.
4. THE system SHALL keep owner, governance, deterministic-domain, runtime, interface, context, archive, and evidence-only authority classes distinct.

### Requirement 2: Deterministic Financial Truth

**User Story:** As the owner, I want all financial facts and decisions sourced by deterministic PFOS engines so that model output cannot alter financial truth.

#### Acceptance Criteria
1. WHEN a financial fact is requested, THE system SHALL obtain it from the Deterministic Finance Port with a source-version reference.
2. WHEN a financial decision is evaluated, THE system SHALL use deterministic PFOS logic and SHALL NOT use an LLM, router, benchmark, Telegram, Hermes, context, or Drive as the source of a monetary magnitude.
3. IF the deterministic finance source is unavailable, THEN THE system SHALL report the unavailable source and SHALL NOT estimate or synthesize a monetary result.
4. WHEN a model explains a financial result, THE explanation SHALL remain non-authoritative and SHALL cite the deterministic result reference.

### Requirement 3: Integer Milliunit Integrity

**User Story:** As the owner, I want all money represented as integer milliunits so that browser, server, migration, and archive calculations remain exact.

#### Acceptance Criteria
1. THE system SHALL represent one EGP as exactly 1000 integer milliunits at every canonical financial boundary.
2. IF a monetary input cannot be parsed losslessly into a safe integer milliunit value, THEN THE system SHALL reject it before deterministic calculation or persistence.
3. WHEN financial data crosses browser, server, migration, queue, or archive boundaries, THE system SHALL preserve exact integer values without floating-point conversion.
4. THE system SHALL mechanically test overflow, rounding, parsing, formatting, and browser/server deterministic parity at defined boundary cases.