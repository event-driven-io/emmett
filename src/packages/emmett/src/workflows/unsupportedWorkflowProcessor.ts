import { EmmettError } from '../errors';
import type { MessageProcessor } from '../processors';

/**
 * Placeholder workflow processor for stores that satisfy the unified consumer
 * contract but have no event-store-backed workflow processor yet (MongoDB,
 * EventStoreDB). It exists so `workflowProcessor` is present on their consumer
 * type, and throws a clear error the moment it is actually used. Replaced once
 * the real store-backed workflow processor lands.
 */
export const unsupportedWorkflowProcessor = (
  _options: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): MessageProcessor<any, any, any> => {
  throw new EmmettError(
    'workflowProcessor is not yet supported for this event store',
  );
};
