#!/usr/bin/env node
/**
 * The autonomous builder's refusal boundary.
 * Owner: build tooling. Contract: PFOS 12 (Two-Agent VPS), R23. Phase: build loop.
 *
 * WHY THIS FILE EXISTS, stated plainly because it is the only thing standing between an
 * unattended loop and a binding prohibition:
 *
 *   ops/GATE_REGISTER.md says, in its own words, "THIS FILE IS A TEMPLATE AND A REGISTER.
 *   NOTHING HERE IS EXECUTED BY AN AGENT. No automated agent runs any command in this file.
 *   Not to test it, not to check whether it would work, not with a placeholder substituted."
 *
 *   Gate discipline rule 5 adds: "Never claim a gated item is done. Marking a gated item
 *   complete is the single most damaging thing possible here: it converts a known gap into
 *   an invisible one."
 *
 * So the builder must be able to recognise gated work from the task text alone and stop.
 *
 * DELIBERATELY FAIL-CLOSED, and the asymmetry is the point. A false refusal costs one owner
 * decision and a line of output. A false pass violates a contract and can mark a human gate
 * satisfied when it is not. Those are not comparable, so the patterns below are broad on
 * purpose and every refusal names the pattern that fired so the owner can override knowingly.
 */

export class GateRefusal extends Error {
  constructor(message, reasons) {
    super(message);
    this.name = "GateRefusal";
    this.reasons = reasons;
  }
}

/** Each rule names itself so a refusal is explainable rather than mysterious. */
export const GATE_RULES = [
  { id: "R-PATH-REGISTER", why: "the task lives in or points at the human gate register",
    test: (t, p) => /GATE_REGISTER/i.test(String(p ?? "")) || /GATE_REGISTER/i.test(t) },
  { id: "R-GATE-ID", why: "the task names a gate identifier G1 to G8",
    test: (t) => /(^|[^A-Za-z0-9])G[1-8]([^A-Za-z0-9]|$)/.test(t) },
  { id: "R-AWAITING-HUMAN", why: "the task carries the blocked-awaiting-human marker",
    test: (t) => /awaiting\s+human|human\s+gate|BLOCKED\s*[-:]\s*awaiting/i.test(t) },
  // PLURALS ARE NOT OPTIONAL HERE. The first version of this rule matched \bkey\b and therefore
  // did NOT match "mint the two model keys", which is the literal wording of gate G4. The
  // negative suite caught it. Every noun below carries s? for that reason.
  { id: "R-MINT-SECRET", why: "the task mints, issues or rotates a real credential",
    test: (t) => /\b(mint|issue|rotate|generate|create)\b[^.]{0,60}\b(tokens?|keys?|secrets?|credentials?|keypairs?|passphrases?)\b/i.test(t) },
  { id: "R-PLACE-SECRET", why: "the task places a real value into the host secret store",
    test: (t) => /\/etc\/[<]?CONFIG_DIR|\/etc\/nizam|\.env\b[^.]{0,40}\b(host|root|chmod\s*600)/i.test(t) },
  { id: "R-PUBLIC-RECORD", why: "the task changes a public record outside this repository",
    test: (t) => /\b(dns|a record|aaaa record|cname|nameserver|registrar|domain purchase|transfer a domain)\b/i.test(t) },
  { id: "R-CONSENT", why: "the task completes an interactive consent or authorisation grant",
    test: (t) => /\b(consent screen|oauth consent|authoriz(?:ation)? code|authoris(?:ation)? code|refresh tokens?)\b/i.test(t) },
  { id: "R-WEBHOOK-REG", why: "the task registers a webhook and makes the deployment reachable",
    test: (t) => /\b(setwebhook|register (both )?webhooks?|webhook registration)\b/i.test(t) },
  { id: "R-SPEND", why: "the task spends money or raises a spend ceiling",
    test: (t) => /\b(purchase|buy|billing|raise the cap|increase the cap|weekly (cap|limit|ceiling)|spend ceiling|payment method)\b/i.test(t) },
  { id: "R-HOST-MUTATE", why: "the task mutates the live host rather than this repository",
    test: (t) => /\b(ssh into|on the host,|systemctl (start|stop|restart|enable)|ufw |sshd_config|apt-get install)\b/i.test(t) },
];

/**
 * @param {string} taskText the task line plus its indented context
 * @param {string} [sourcePath] the file the task came from
 * @returns {{gated: boolean, reasons: {id: string, why: string}[]}}
 */
export function gateVerdict(taskText, sourcePath) {
  const t = String(taskText ?? "");
  const reasons = [];
  for (const rule of GATE_RULES) {
    let fired = false;
    try {
      fired = Boolean(rule.test(t, sourcePath));
    } catch {
      // A rule that throws is treated as FIRED. An unevaluatable guard is not a passing guard.
      fired = true;
    }
    if (fired) reasons.push({ id: rule.id, why: rule.why });
  }
  return { gated: reasons.length > 0, reasons };
}

/** Throws GateRefusal when the task is gated. Returns the verdict when it is not. */
export function assertNotGated(taskText, sourcePath) {
  const verdict = gateVerdict(taskText, sourcePath);
  if (verdict.gated) {
    throw new GateRefusal(
      "refusing a gated task: " + verdict.reasons.map((r) => r.id).join(", "),
      verdict.reasons,
    );
  }
  return verdict;
}
