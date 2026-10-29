export * from './outcome.js';
export * from './canonical.js';
export * from './verdict.js';
export * from './compose.js';
export * from './check.js';
export * from './event.js';
export * from './replay.js';
export * from './render.js';
export * from './version-doc.js';
export { COMMIT_PATTERN, ISO_TIME_PATTERN } from './validate.js';
export { invariantCheck, type InvariantInput } from './checks/invariant.js';
export {
  READBACK_STATES,
  markerKey,
  parseReadbackChange,
  parseReadbackInput,
  READBACK_LIMITS,
  readbackCheck,
  readbackSightings,
  type AncestryFact,
  type BundleObservation,
  type Marker,
  type ReadbackChange,
  type ReadbackInput,
  type ReadbackState,
  type Sighting,
  type VersionObservation,
} from './checks/readback.js';

import { CheckRegistry } from './check.js';
import { invariantCheck } from './checks/invariant.js';
import { readbackCheck } from './checks/readback.js';

/** Every check this version of seamkit can run and replay. */
export function defaultRegistry(): CheckRegistry {
  return new CheckRegistry().register(invariantCheck).register(readbackCheck);
}
