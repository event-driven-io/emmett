import { EmmettError } from '../errors';
import type { AnyMessageProcessor } from '../processors';

/**
 * Placeholder workflow processor for stores that satisfy the unified consumer
 * contract but have no event-store-backed workflow processor yet (MongoDB,
 * EventStoreDB). It exists so `workflowProcessor` is present on their consumer
 * type, and throws a clear error the moment it is actually used. Replaced once
 * the real store-backed workflow processor lands.
 */
export type UnsupportedWorkflowProcessorOptions = {
  workflow: unknown;
};

export const unsupportedWorkflowProcessor = (
  _options: UnsupportedWorkflowProcessorOptions,
): AnyMessageProcessor => {
  throw new EmmettError(
    'workflowProcessor is not yet supported for this event store',
  );
};
