import {
  asyncRetry,
  bigIntProcessorCheckpoint,
  getCheckpoint,
  parseBigIntProcessorCheckpoint,
  type AsyncRetryOptions,
  type ProcessorCheckpoint,
} from '@event-driven-io/emmett';
import type { EventStoreDBClient } from '@eventstore/db-client';
import {
  BACKWARDS,
  END,
  StreamNotFoundError,
  type AllStreamResolvedEvent,
  type ResolvedEvent,
} from '@eventstore/db-client';
import { mapFromESDBEvent } from '../../eventstoreDBEventStore';
import {
  $all,
  type EventStoreDBEventStoreConsumerType,
} from '../eventStoreDBEventStoreConsumer';

const ProjectionStreamWaitOptions: AsyncRetryOptions<
  ProcessorCheckpoint | undefined
> = {
  retries: 100,
  minTimeout: 50,
  factor: 1,
  shouldRetryError: (error) => error instanceof ProjectionStreamBehindError,
};

class ProjectionStreamBehindError extends Error {
  constructor() {
    super('EventStoreDB projection stream has not caught up yet');
  }
}

const isSystemEvent = (resolvedEvent: AllStreamResolvedEvent): boolean =>
  resolvedEvent.event?.type?.startsWith('$') ?? true;

const isProjectionStreamWithLinks = (
  from: EventStoreDBEventStoreConsumerType,
): boolean =>
  ['$ce-', '$et-'].some((prefix) => from.stream.startsWith(prefix)) &&
  from.options?.resolveLinkTos === true;

const streamNamePrefix = (projectionStream: string): string =>
  projectionStream.substring('$ce-'.length);

const eventType = (eventTypeStream: string): string =>
  eventTypeStream.substring('$et-'.length);

const isEventInProjection = (
  resolvedEvent: AllStreamResolvedEvent,
  projectionStream: string,
): boolean => {
  if (projectionStream.startsWith('$ce-'))
    return (
      resolvedEvent.event?.streamId.startsWith(
        `${streamNamePrefix(projectionStream)}-`,
      ) ?? false
    );

  if (projectionStream.startsWith('$et-'))
    return resolvedEvent.event?.type === eventType(projectionStream);

  return false;
};

const asProcessorCheckpoint = (
  checkpoint: string | undefined,
): ProcessorCheckpoint | undefined =>
  checkpoint === undefined
    ? undefined
    : bigIntProcessorCheckpoint(BigInt(checkpoint));

const readLastAllCheckpoint = async (
  client: EventStoreDBClient,
  from: EventStoreDBEventStoreConsumerType | undefined,
): Promise<ProcessorCheckpoint | undefined> => {
  const stream = client.readAll({
    direction: BACKWARDS,
    fromPosition: END,
    resolveLinkTos: false,
  });

  for await (const resolvedEvent of stream) {
    if (isSystemEvent(resolvedEvent)) continue;

    return (
      getCheckpoint(mapFromESDBEvent(resolvedEvent as ResolvedEvent, from)) ??
      undefined
    );
  }

  return undefined;
};

const readLastStreamCheckpoint = async (
  client: EventStoreDBClient,
  from: EventStoreDBEventStoreConsumerType,
): Promise<ProcessorCheckpoint | undefined> => {
  try {
    const stream = client.readStream(from.stream, {
      direction: BACKWARDS,
      fromRevision: END,
      maxCount: 1,
      ...(from.options ?? {}),
    });

    for await (const resolvedEvent of stream) {
      return getCheckpoint(mapFromESDBEvent(resolvedEvent, from)) ?? undefined;
    }

    return undefined;
  } catch (error) {
    if (error instanceof StreamNotFoundError) return undefined;
    throw error;
  }
};

const readLastProjectionStreamCheckpoint = async (
  client: EventStoreDBClient,
  from: EventStoreDBEventStoreConsumerType,
): Promise<
  | {
      checkpoint: ProcessorCheckpoint;
      originalGlobalCheckpoint: ProcessorCheckpoint | undefined;
    }
  | undefined
> => {
  try {
    const stream = client.readStream(from.stream, {
      direction: BACKWARDS,
      fromRevision: END,
      maxCount: 1,
      ...(from.options ?? {}),
    });

    for await (const resolvedEvent of stream) {
      const message = mapFromESDBEvent(resolvedEvent, from);
      const checkpoint = getCheckpoint(message);

      if (checkpoint === null) return undefined;

      return {
        checkpoint,
        originalGlobalCheckpoint: asProcessorCheckpoint(
          message.metadata.globalPosition,
        ),
      };
    }

    return undefined;
  } catch (error) {
    if (error instanceof StreamNotFoundError) return undefined;
    throw error;
  }
};

const readLastProjectionGlobalCheckpoint = async (
  client: EventStoreDBClient,
  from: EventStoreDBEventStoreConsumerType,
): Promise<ProcessorCheckpoint | undefined> => {
  const stream = client.readAll({
    direction: BACKWARDS,
    fromPosition: END,
    resolveLinkTos: false,
  });

  for await (const resolvedEvent of stream) {
    if (isSystemEvent(resolvedEvent)) continue;
    if (!isEventInProjection(resolvedEvent, from.stream)) continue;

    return (
      getCheckpoint(
        mapFromESDBEvent(resolvedEvent as ResolvedEvent, { stream: $all }),
      ) ?? undefined
    );
  }

  return undefined;
};

const waitForProjection = async (
  client: EventStoreDBClient,
  from: EventStoreDBEventStoreConsumerType,
): Promise<ProcessorCheckpoint | undefined> =>
  asyncRetry(async () => {
    const lastProjectionGlobalCheckpoint =
      await readLastProjectionGlobalCheckpoint(client, from);

    if (lastProjectionGlobalCheckpoint === undefined) return undefined;

    const projectionTail = await readLastProjectionStreamCheckpoint(
      client,
      from,
    );

    if (
      projectionTail === undefined ||
      projectionTail.originalGlobalCheckpoint === undefined ||
      parseBigIntProcessorCheckpoint(projectionTail.originalGlobalCheckpoint) <
        parseBigIntProcessorCheckpoint(lastProjectionGlobalCheckpoint)
    )
      throw new ProjectionStreamBehindError();

    return projectionTail.checkpoint;
  }, ProjectionStreamWaitOptions);

/**
 * Reads the checkpoint of the last committed message from the same logical stream
 * the subscription consumes. Projection streams can lag behind writes, so they
 * are retried until the standard EventStoreDB projection exposes the tail event.
 */
export const readLastCommittedMessageCheckpoint = async (
  client: EventStoreDBClient,
  from: EventStoreDBEventStoreConsumerType | undefined,
): Promise<ProcessorCheckpoint | undefined> => {
  if (from === undefined || from.stream === $all)
    return readLastAllCheckpoint(client, from);

  if (isProjectionStreamWithLinks(from)) return waitForProjection(client, from);

  return readLastStreamCheckpoint(client, from);
};
