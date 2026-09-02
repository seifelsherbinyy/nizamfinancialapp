# Hermes protected-environment handoff

> Owning authority: PFOS Contracts 12 and 13, `ops/DEPLOYMENT_CONTROL.md`, and the two-agent
> deployment plan.
> Status: operator procedure only. An agent must not execute this note, read `.secrets/`, or
> substitute a real value into a tracked file.

## Boundary

The builder is allowed to create and test the non-secret wiring, templates, and presence checks.
It must not receive the contents of `.secrets/`, print a token or key, or upload the whole directory.
The owner performs the final transfer from an owner-controlled terminal after the applicable human
gates are complete.

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

   The host address and key path are operator-session values. They must not be written into this
   repository or passed through the builder.
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
