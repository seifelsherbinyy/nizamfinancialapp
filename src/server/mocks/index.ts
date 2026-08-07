/**
 * NIZAM · Deterministic port mocks barrel — the BUILD half of five gated boundaries
 * Implemented by: PFOS Contract 12 / Phase 2.2 (spec 06-two-agent-vps)
 * Depends on: driveMock, failure, fixtures, invocationRecorder, openrouterMock, signalBusMock,
 *   telegramMock, whoopMock
 *
 * Why this directory is NOT `src/server/ports/mocks/`
 *   `ports/interfaceOnly.test.ts` computes its scan root from its own location and recurses into
 *   every subdirectory, excluding only `*.test.ts`. A mock placed anywhere under `src/server/ports/`
 *   would therefore be scanned as a declaration file and reported for containing a function, an
 *   arrow, a class, a constructor and a return — correctly, because that is exactly what a mock is.
 *   The right response is to put the implementations outside the tree that promises to hold none,
 *   not to widen the promise. So the mocks are a SIBLING of the ports, and Phase 2.1's assertion
 *   keeps its full strength.
 *
 * What still applies here, because `src/server/db`'s two source scans cover the whole `src/server`
 * tree: no cross-database open statement, no second money implementation, no float touching money.
 * And AC08b keeps every one of these files out of the browser bundle, in both directions.
 *
 * Determinism is the contract of this directory (design key decision 1). Every mock below takes an
 * injected clock where it needs a timestamp, derives every reference from its inputs, reads no
 * ambient state, and touches neither network nor filesystem — the one exception being
 * {@link nodeFixtureSource}, which a caller has to construct on purpose.
 */

// The recording primitive. §6.1 / R16: assert the record is empty.
export {
  MOCK_PORT_NAMES,
  createInvocationRecorder,
  type DetailValue,
  type Invocation,
  type InvocationRecorder,
  type MockPortName,
  type RecordableDetail,
} from './invocationRecorder';

// One thrower for five boundaries.
export { MockPortFailure, isMockPortFailure } from './failure';

// Transport — contract 12 §5.
export { createTelegramMock, type TelegramMock, type TelegramMockConfig } from './telegramMock';

// Model routing — contract 12 §6.
export {
  createOpenRouterMock,
  type OpenRouterMock,
  type OpenRouterMockConfig,
  type RecordedModelExchange,
} from './openrouterMock';

// Backup egress — contract 12 §7.1.
export { createDriveMock, type DriveMock, type DriveMockConfig } from './driveMock';

// Recovery context — the life tier's connector as this side agrees to see it.
export { createWhoopMock, type WhoopMock, type WhoopMockConfig } from './whoopMock';

// The consent bus — contract 12 §4.
export {
  createSignalBusMock,
  type ReadableTiers,
  type SignalBusMock,
  type SignalBusMockConfig,
} from './signalBusMock';

// Recorded fixtures — steering §3's offline fallback.
export {
  FIXTURE_DIRECTORY,
  FIXTURE_ERROR_CODES,
  FIXTURE_VERSION,
  FixtureError,
  bytesFromHex,
  inlineFixtureSource,
  loadRecordedInteractions,
  nodeFixtureSource,
  signalDraftFrom,
  snapshotArtifactFrom,
  type FixtureErrorCode,
  type FixtureSource,
  type LoadedFixture,
  type RecordedInteractionSet,
  type RecordedSignal,
  type RecordedSnapshot,
} from './fixtures';
