export * from './outcome.js';
export * from './canonical.js';
export * from './verdict.js';
export * from './compose.js';
export * from './check.js';
export * from './event.js';
export * from './replay.js';
export * from './render.js';
export { invariantCheck, type InvariantInput } from './checks/invariant.js';

import { CheckRegistry } from './check.js';
import { invariantCheck } from './checks/invariant.js';

/** Every check this version of seamkit can run and replay. */
export function defaultRegistry(): CheckRegistry {
  return new CheckRegistry().register(invariantCheck);
}
