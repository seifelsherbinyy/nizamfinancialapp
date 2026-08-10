/**
 * NIZAM · Deterministic answers — a named, listed intent set answered in a human sentence
 * Implemented by: PFOS Contract 12 / Phase 2, task **B7**, seam **S6** (spec 07-bot-bringup-v1)
 * Owning requirements: R16 (this is the `T0` route: it reaches no model and mints nothing), R19
 *   (nothing here reads or writes turn content), R24 (no host, no bot, no sender, no figure),
 *   contract 12 §6's standing invariant (the model/router tier never sources a monetary number —
 *   and this tier does not source one either, for the reason below)
 * Depends on: ../routing/turnClassifier (the intent set and the family map, type and value). No
 *   store, no clock, no port, no network, no arithmetic, no `src/lib/money`.
 *
 * The deterministic route at `main.ts` returned the turn's own correlation reference, so a reply
 * was a bare identifier. This module is the answer, and it is thin on purpose.
 *
 * ## What it is NOT, stated first because that is the part that could be got wrong
 *
 * **This is not the Stage 1-4 engine wiring, and it quotes no figure.** The contract's own scope
 * line keeps those engines out of v1.0: "Bot B converses about budgeting from the ingested ledger
 * and the web app, without the Stage 1-4 engines wired to chat." So a sentence here says what the
 * deterministic operation IS and where the owner reads the number — never the number. There is no
 * balance, no limit, no total, no date and no ratio below, and there is no arithmetic that could
 * produce one: the only value this module holds is a set of frozen strings.
 *
 * That is a stronger statement than a promise. `NO_FIGURE_PATTERN` is asserted over every sentence
 * by the tests, so a digit added to one of these strings later fails the suite rather than reaching
 * the owner as an authoritative-looking number nobody computed.
 *
 * ## The set is NAMED and LISTED, which is the whole of the task
 *
 * {@link ANSWERED_INTENTS} is exactly contract 10's deterministic family — the six intents
 * `classifyTurn` routes `T0` — and {@link DETERMINISTIC_ANSWERS} is a `Record` over the full intent
 * union, so an intent added to the classifier without a sentence fails to compile. Every intent
 * outside the family is answered by {@link OUT_OF_FAMILY_ANSWER}, because this function's signature
 * accepts any facts even though `dispatchTurn` only ever calls it on the `T0` branch: a total
 * function cannot be reached with nothing to say.
 */
import { INTENT_FAMILY, TURN_INTENTS, type TurnFacts, type TurnIntent } from '../routing/turnClassifier.ts';

/**
 * The intents answered here, named and listed. Derived from {@link INTENT_FAMILY} rather than
 * re-typed, so the list cannot drift from the classifier's own family assignment — which is what
 * decides `T0`, and therefore what decides which turns actually arrive at this function.
 */
export const ANSWERED_INTENTS: readonly TurnIntent[] = Object.freeze(
  TURN_INTENTS.filter((intent) => INTENT_FAMILY[intent] === 'deterministic'),
);

/**
 * What a turn outside the deterministic family is told, if one ever arrives.
 *
 * It cannot today: `dispatchTurn` calls this only where the classification was `T0`, and `T0` is
 * exactly the deterministic family. It exists so the function is total, and it says something true
 * rather than something reassuring.
 */
export const OUT_OF_FAMILY_ANSWER =
  'I read that as a turn the conversational side answers, not the deterministic one, so there is nothing for me to compute here.';

/**
 * One sentence per intent. A `Record` over the whole union, so a new intent must be given a sentence
 * before it compiles.
 *
 * Each sentence names the operation and, where a figure would be the natural answer, points at the
 * owner-only web view — which is where v1.0 puts every number the owner reviews. None of them
 * contains a digit, a currency, an account, a date or a name (R24, §6).
 */
export const DETERMINISTIC_ANSWERS: Readonly<Record<TurnIntent, string>> = Object.freeze({
  recalculate_balances:
    'Balances are recalculated from the ledger by the deterministic engines, so no model is asked for them. The figures themselves are shown in your own web view rather than quoted here.',
  compute_safe_to_spend:
    'Safe-to-spend is computed deterministically from your obligations and your policy, never estimated by a model. Open your own web view to read the current figure.',
  detect_exact_duplicate:
    'Duplicate detection is an exact key match over the ledger, so it either matches or it does not, and a model is never asked to guess. Your web view lists whatever it found.',
  apply_known_payment_schedule:
    'A known payment schedule is applied by rule, in the order the schedule states, with no model involved at any step.',
  emit_fixed_format_reminder:
    'A reminder is emitted in a fixed format from your obligations, and it fires whether or not the model tier is available, because a due-date warning is never gated.',
  validate_schema:
    "I could not read that as one of the operations I answer, so nothing was computed and nothing was sent to a model. Send a command word, or ask about your budget in a sentence and I will treat it as a conversation.",
  parse_bank_message: OUT_OF_FAMILY_ANSWER,
  normalize_merchant: OUT_OF_FAMILY_ANSWER,
  suggest_category: OUT_OF_FAMILY_ANSWER,
  summarize_confirmed_transaction: OUT_OF_FAMILY_ANSWER,
  explain_safe_to_spend: OUT_OF_FAMILY_ANSWER,
  periodic_briefing: OUT_OF_FAMILY_ANSWER,
  identify_leakage: OUT_OF_FAMILY_ANSWER,
  compare_ordinary_budget_options: OUT_OF_FAMILY_ANSWER,
  request_correction: OUT_OF_FAMILY_ANSWER,
  evaluate_financial_decision: OUT_OF_FAMILY_ANSWER,
  repository_engineering: OUT_OF_FAMILY_ANSWER,
});

/**
 * A sentence that must hold no figure. Any run of digits at all: a sentence with a number in it is
 * either a figure or a step count that will be read as one, and neither belongs in a reply this tier
 * composes without the engines.
 */
export const NO_FIGURE_PATTERN = /\d/;

/**
 * The deterministic route (**seam S6**), in the shape
 * `TurnDispatchDependencies.executeDeterministically` wants.
 *
 * Pure and total: the same facts always yield the same sentence, with no clock, no randomness and no
 * I/O. `turnRef` is accepted because the seam supplies it and deliberately NOT placed in the
 * sentence: a correlation reference is an operator's pointer, and putting it in front of the owner is
 * how the reply became an identifier in the first place.
 */
export function answerDeterministically(facts: TurnFacts, turnRef: string): string {
  void turnRef;
  return DETERMINISTIC_ANSWERS[facts.intent];
}
