# Hermes protected-environment handoff

> Owning authority: PFOS Contracts 12 and 13, `ops/DEPLOYMENT_CONTROL.md`, and the two-agent
> deployment plan.
> Status: operator procedure for the credential TRANSFER steps below. Under the standing operator
> directive recorded next, an authorised agent may connect to and develop on the VPS using the
> credential paths in `.secrets/`; it still may not read a secret value into its output, print one,
> or substitute a real value into a tracked file.

> **Operator directive, 2026-09-02 (STANDING). Supersedes the agent restriction below.**
> The system owner has authorised the local coding agent to access, configure, develop, test and
> operate the assigned NIZAM/Hermes VPS: to use the already-configured host, username, SSH
> configuration and private-key **path** from the local operator environment, to open authenticated
> SSH/SFTP/rsync sessions, to inspect the filesystem, repositories, containers, services, packages,
> logs, processes and networking, and to create, modify, install, configure, execute, test, restart
> and debug NIZAM/Hermes components there. The VPS is Hermes' primary development and runtime home,
> not a sandbox around it. Do not treat this note as a blocker.
>
> **Authorisation to USE a credential is not authorisation to DISCLOSE it.** The agent authenticates
> by path, environment variable, SSH-agent identity or local credential store. It reads no secret
> VALUE into its output. The following remain in force and are not weakened by the directive:
> no private key, token, password or credential value is ever printed, reproduced in a response,
> log, report, tracked file, commit or document; `.secrets/` is never copied into the repository;
> and by §2's standing invariant no tracked file may carry a deployment particular, which is what
> the AC11 and AC18 acceptance checks enforce on every run.
>
> **Still human-only, because these are credential and external-authority lifecycle, not
> development:** G2 DNS/TLS records, G3 bot token minting and allowlist, G4 OpenRouter key minting,
> G5 OAuth consent, G6 webhook registration, G8 backup keypair, any credential creation or rotation,
> and any production spend or transfer. The agent may report that one of these is required; it does
> not perform it.

## Boundary

The builder creates and tests the non-secret wiring, templates and presence checks, and under the
standing directive above it also connects to and operates the VPS using the credential paths in
`.secrets/`. It must not read a secret value into its context or output, print a token or key, copy
`.secrets/` into the repository, or upload the whole directory. Authenticate by path or agent
identity and let the tool consume the file; never open it to look.

The owner still performs the credential TRANSFER in the numbered procedure below from an
owner-controlled terminal after the applicable human gates are complete, because installing a
production token into a service home is credential lifecycle, not development.

Only the two assembled Hermes environment files belong in the Hermes service homes:

- NIZAM: its bot token, its model key, the owner allowlist, its profile home, and the kill setting.
- PFOS: its bot token, its model key, the owner allowlist, its profile home, and the kill setting.

Do not place the VPS access key, backup identity, storage refresh token, provider management key,
Cloudflare material, or the complete `.secrets/` directory in either Hermes environment.

## Owner-run transfer shape

1. On the owner machine, assemble each profile file from the protected local sources. Keep the file
   outside the repository and do not paste it into chat, a ticket, or a shell command line.
2. Verify locally that each file contains only the five names required by its profile template and
   that the NIZAM and PFOS files use different bot-token and model-key sources.
3. From the owner terminal, copy one file at a time to a temporary path in the operator account's
   home on the VPS. Resolve all placeholders privately:

   ```text
   scp -i <VPS_OPERATOR_KEY> -o StrictHostKeyChecking=yes <LOCAL_NIZAM_ENV_FILE> <OPERATOR_USER>@<HOST_ADDRESS>:/home/<OPERATOR_USER>/<NIZAM_INCOMING_FILE>
   scp -i <VPS_OPERATOR_KEY> -o StrictHostKeyChecking=yes <LOCAL_PFOS_ENV_FILE> <OPERATOR_USER>@<HOST_ADDRESS>:/home/<OPERATOR_USER>/<PFOS_INCOMING_FILE>
   ```

   The host address and key path are operator-session values. They must never be written into this
   repository, which §2's invariant and the AC11/AC18 checks enforce. The authorised agent may hold
   and use them in a session to connect; it may not persist or print them.
4. In a separate owner SSH session, install the files into the root-owned service locations with
   mode `600`, then remove the incoming copies. Use the exact target paths chosen during G1; do not
   create a second copy under the application checkout.
5. Run the value-blind checks from the deployment register: file ownership and mode, one entry per
   required name, matching shared non-secret settings, and the negative checks proving that each
   profile lacks the other profile's token and model key.
6. Keep both profiles halted until the registry, cutover, and duplicate-polling checks are complete.
   Start one profile at a time and observe its process identity before enabling the other.

## What the builder can verify before the handoff

The repository-side checks can prove that:

- both unit templates invoke `gateway run` with no shell wrapper;
- each unit binds only its own profile home and protected environment file;
- the unit hardening settings are present;
- the profile model defaults are NIZAM `xiaomi/mimo-v2.5` and PFOS `z-ai/glm-5.2`;
- copied placeholders are refused;
- missing secrets are reported by name only;
- the validator never returns or renders token/key values.

Those checks do not prove that a credential is valid, a provider call is affordable, Telegram
ownership has been cut over, or a host is ready. Those remain human-gated observations in
`ops/DEPLOYMENT_CONTROL.md`.
