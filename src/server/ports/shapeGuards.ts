/**
 * NIZAM · Port shape guards — make the forbidden shape inexpressible, not merely rejected
 * Implemented by: PFOS Contract 12 / Phase 2.1 (spec 06-two-agent-vps)
 * Depends on: none (type level only; this module has no runtime export at all)
 *
 * Design key decision 1 says every external boundary is an injected interface. Contract 12
 * §4.3 says the *reason* that is safe is not the interface itself but the shape of what the
 * interface accepts: a runtime filter is code that can be bypassed, mis-ordered, disabled
 * under load, or forgotten at a new call site, and its failure mode is silent leakage that
 * looks like success. A shape that cannot carry the value fails loudly at the producer,
 * before anything is stored or sent.
 *
 * These three helpers are how that argument becomes a compile error rather than a comment.
 * They hold no data and describe no external system, which is why they live apart from the
 * five ports that use them.
 */

/**
 * Every key of `T` that is beyond `Shape`, typed `never`.
 *
 * TypeScript's own excess-property check only fires on a *fresh* object literal, so
 * `const p = { level: 'red', balance: 1 }; publish({ payload: p })` would pass. Mapping the
 * surplus keys to `never` closes that hole: the surplus key still has to be satisfied, and
 * nothing satisfies `never`.
 */
export type NoFieldBeyond<Shape, T> = {
  readonly [K in Exclude<keyof T, keyof Shape>]: never;
};

/**
 * `Shape`, and nothing beyond `Shape`. Used as a self-referencing constraint —
 * `publish<P extends Exact<SignalPayload, P>>(…)` — so exactness is checked against the
 * inferred argument type rather than against a literal's freshness.
 */
export type Exact<Shape, T> = Shape & NoFieldBeyond<Shape, T>;

/** The keys of `T` whose value is a number, optional or not. */
export type MagnitudeKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends number ? K : never;
}[keyof T];

/**
 * `T` with every numeric field typed `never`.
 *
 * Contract 12 §4.3.1: a consent payload accepts no numeric field of any kind — a level is
 * an enum, not a number. Today this resolves to `T` unchanged, because no such field
 * exists. Its purpose is tomorrow: an editor who adds `amountMilli: number` to a guarded
 * shape makes that field uninhabitable, so the addition fails to compile instead of quietly
 * opening a channel for a balance.
 */
export type NoMagnitude<T> = T & { readonly [K in MagnitudeKeys<T>]: never };

/**
 * Key names that carry model content rather than a redacted feature. Contract 12 §6.4
 * (owning requirement R19): no prompt text and no completion text is written to any log —
 * not at debug level, not on error, not in a crash dump, not in a bus signal, not in a
 * backup manifest.
 */
export type ContentBearingKey =
  | 'body'
  | 'completion'
  | 'completionText'
  | 'content'
  | 'messages'
  | 'prompt'
  | 'promptText'
  | 'prompts'
  | 'text';

/**
 * `T` with every content-bearing field typed `never`, for the record types that are allowed
 * to be logged. §6.4 permits redacted features — a tier, a model identity, token counts,
 * latency, a schema verdict, an actual reported cost, a correlation reference. Wrapping the
 * loggable record in this makes the ban structural: a field named for content cannot hold a
 * string, so the redaction is a property of the schema rather than of a formatting string
 * that someone will eventually change.
 */
export type Redacted<T> = T & { readonly [K in Extract<keyof T, ContentBearingKey>]: never };
