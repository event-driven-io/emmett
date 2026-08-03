import {
  getCheckpoint,
  type ProcessorCheckpoint,
} from '@event-driven-io/emmett';
import type { EventStoreDBClient } from '@eventstore/db-client';
import {
  BACKWARDS,
  END,
  StreamNotFoundError,
  type AllStreamResolvedEvent,
  type ReadPosition,
  type ResolvedEvent,
} from '@eventstore/db-client';
import { mapFromESDBEvent } from '../../eventstoreDBEventStore';
import {
  $all,
  type EventStoreDBEventStoreConsumerType,
} from '../eventStoreDBEventStoreConsumer';

const isSystemEvent = (resolvedEvent: AllStreamResolvedEvent): boolean =>
  resolvedEvent.event?.type?.startsWith('$') ?? true;

const AllStreamReadPageSize = 32;
const MaxAllStreamScanPages = 64;

const readLastMatchingAllCheckpoint = async (
  client: EventStoreDBClient,
  matches: (event: AllStreamResolvedEvent) => boolean,
): Promise<ProcessorCheckpoint | undefined> => {
  let fromPosition: ReadPosition = END;
  let overlapEventId: string | undefined;

  for (let page = 0; page < MaxAllStreamScanPages; page++) {
    const stream = client.readAll({
      direction: BACKWARDS,
      fromPosition,
      resolveLinkTos: false,
      maxCount: AllStreamReadPageSize,
    });
    let inspected = 0;
    let oldestPosition: ReadPosition | undefined;
    let oldestEventId: string | undefined;
    let checkpoint: ProcessorCheckpoint | undefined;

    for await (const resolvedEvent of stream) {
      inspected++;
      oldestPosition =
        resolvedEvent.event?.position ?? resolvedEvent.link?.position;
      oldestEventId = resolvedEvent.event?.id ?? resolvedEvent.link?.id;

      if (
        resolvedEvent.event?.id === overlapEventId ||
        checkpoint !== undefined ||
        !matches(resolvedEvent)
      )
        continue;

      checkpoint =
        getCheckpoint(
          mapFromESDBEvent(resolvedEvent as ResolvedEvent, { stream: $all }),
        ) ?? undefined;
    }

    if (checkpoint !== undefined) return checkpoint;

    if (
      inspected < AllStreamReadPageSize ||
      oldestPosition === undefined ||
      oldestEventId === undefined ||
      oldestEventId === overlapEventId
    )
      return undefined;

    fromPosition = oldestPosition;
    overlapEventId = oldestEventId;
  }

  return undefined;
};

const readLastAllCheckpoint = async (
  client: EventStoreDBClient,
): Promise<ProcessorCheckpoint | undefined> =>
  readLastMatchingAllCheckpoint(client, (event) => !isSystemEvent(event));

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
    let checkpoint: ProcessorCheckpoint | undefined;

    for await (const resolvedEvent of stream) {
      checkpoint =
        getCheckpoint(mapFromESDBEvent(resolvedEvent, from)) ?? undefined;
    }

    return checkpoint;
  } catch (error) {
    if (error instanceof StreamNotFoundError) return undefined;
    throw error;
  }
};

/**
 * Reads the checkpoint of the last committed message from the stream the
 * subscription consumes.
 */
export const readLastCommittedMessageCheckpoint = async (
  client: EventStoreDBClient,
  from: EventStoreDBEventStoreConsumerType | undefined,
): Promise<ProcessorCheckpoint | undefined> => {
  if (from === undefined || from.stream === $all)
    return readLastAllCheckpoint(client);

  return readLastStreamCheckpoint(client, from);
};
