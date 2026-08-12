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

/**
 * NEGATION AWARENESS, and why it is deliberately partial.
 *
 * A task that says "no loopback listener, no port, no DNS, no recorded transcript" is describing
 * what it REFUSES to touch. The first version of R-PUBLIC-RECORD matched the bare word DNS inside
 * that sentence and blocked a pure offline test task. A task that says "do not perform any G1-G8
 * step" is the safest wording a task can have, and R-GATE-ID blocked it. Both are perverse.
 *
 * So a hit may be suppressed when a negator sits immediately before it. But ONLY for rules that
 * detect a CAPABILITY MENTION. Never for a rule that detects an IRREVERSIBLE ACTION, because
 * "do not mint the key" appearing in a task that goes on to mint it must still refuse. The
 * asymmetry is the whole design: suppression is allowed to reduce noise, never to reduce safety.
 */
const NEGATOR = /(?:\bno\b|\bnot\b|\bnever\b|\bwithout\b|\bcannot\b|\bcan't\b|\bdon't\b|\bdo not\b|\bmust not\b|\bnon-)[^.]{0,40}$/i;
const NEGATION_WINDOW = 48;

function firesWithNegationCheck(regex, text, negatable) {
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!negatable) return { fired: true, matched: m[0] };
    const before = text.slice(Math.max(0, m.index - NEGATION_WINDOW), m.index);
    if (!NEGATOR.test(before)) return { fired: true, matched: m[0] };
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return { fired: false, matched: null };
}

export class GateRefusal extends Error {
  constructor(message, reasons) {
    super(message);
    this.name = "GateRefusal";
    this.reasons = reasons;
  }
}

/** Each rule names itself so a refusal is explainable rather than mysterious. */
export const GATE_RULES = [
  // ---- NEVER suppressed by a negation: these detect an irreversible action or a hard marker.
  { id: "R-PATH-REGISTER", negatable: false, why: "the task lives in or points at the human gate register",
    re: /GATE_REGISTER/i, alsoPath: true },
  { id: "R-AWAITING-HUMAN", negatable: false, why: "the task carries the blocked-awaiting-human marker",
    re: /awaiting\s+human|human\s+gate|owner\s+blocker|BLOCKED\s*[-:]\s*awaiting/i },
  // PLURALS ARE NOT OPTIONAL. The first version matched \bkey\b and so did NOT match "mint the two
  // model keys", the literal wording of gate G4. The negative suite caught it.
  { id: "R-MINT-SECRET", negatable: false, why: "the task mints, issues or rotates a real credential",
    re: /\b(mint|issue|rotate|generate|create)\b[^.]{0,60}\b(tokens?|keys?|secrets?|credentials?|keypairs?|passphrases?)\b/i },
  { id: "R-PLACE-SECRET", negatable: false, why: "the task places a real value into the host secret store",
    re: /\/etc\/[<]?CONFIG_DIR|\/etc\/nizam|\.env\b[^.]{0,40}\b(host|root|chmod\s*600)/i },
  { id: "R-CONSENT", negatable: false, why: "the task completes an interactive consent or authorisation grant",
    re: /\b(consent screen|oauth consent|authoriz(?:ation)? code|authoris(?:ation)? code|refresh tokens?)\b/i },
  { id: "R-SPEND", negatable: false, why: "the task spends money or raises a spend ceiling",
    re: /\b(purchase|buy|billing|raise the cap|increase the cap|weekly (cap|limit|ceiling)|spend ceiling|payment method)\b/i },

  // ---- suppressible by an immediately preceding negation: these detect a capability MENTION.
  { id: "R-GATE-ID", negatable: true, why: "the task names a gate identifier G1 to G8",
    re: /(?:^|[^A-Za-z0-9])G[1-8](?:[^A-Za-z0-9]|$)/ },
  { id: "R-PUBLIC-RECORD", negatable: true, why: "the task changes a public record outside this repository",
    re: /\b(dns|a record|aaaa record|cname|nameserver|registrar|domain purchase|transfer a domain)\b/i },
  { id: "R-WEBHOOK-REG", negatable: true, why: "the task registers a webhook and makes the deployment reachable",
    re: /\b(setwebhook|getwebhookinfo|register (?:both )?webhooks?|webhook registration)\b/i },
  { id: "R-HOST-MUTATE", negatable: true, why: "the task mutates the live host rather than this repository",
    re: /\b(ssh into|on the host,|systemctl (?:start|stop|restart|enable)|ufw |sshd_config|apt-get install)\b/i },
];

/**
 * @param {string} taskText the task line plus its indented context
 * @param {string} [sourcePath] the file the task came from
 * @returns {{gated: boolean, reasons: {id: string, why: string}[]}}
 */
export function gateVerdict(taskText, sourcePath) {
  const t = String(taskText ?? "");
  const p = String(sourcePath ?? "");
  const reasons = [];
  for (const rule of GATE_RULES) {
    let fired = false, matched = null;
    try {
      if (rule.alsoPath && rule.re.test(p)) { fired = true; matched = p; }
      if (!fired) {
        const r = firesWithNegationCheck(rule.re, t, Boolean(rule.negatable));
        fired = r.fired; matched = r.matched;
      }
    } catch {
      // A rule that throws is treated as FIRED. An unevaluatable guard is not a passing guard.
      fired = true; matched = "RULE_FAULT";
    }
    if (fired) reasons.push({ id: rule.id, why: rule.why, matched });
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
