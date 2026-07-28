# Product — NIZAM
**What:** a private, single-user, YNAB-style personal-finance webapp for one person (Egypt context).
**Why:** replace the one-off "Financial Rescue" pipeline with a living zero-based budgeting app that ingests the user's real bank data and helps break the high-interest debt loop, improve iScore, and reach HSBC-Egypt loan readiness (see docs/research).
**Non-goals (v1):** multi-user, cloud multi-tenant SaaS, regulated financial advice, real-time bank API/open-banking.
**Design north star:** YNAB's four rules + register/budget UX; Actual Budget's local-first architecture as the reference pattern.
**Privacy tenet:** the user's financial data belongs to the user. The DATABASE is the user's own Google Drive. No third-party servers. Sensitive fields (account identifiers) are REDACTED in the UI by default (last-4).
