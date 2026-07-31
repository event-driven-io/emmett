import {
  parseBigIntProcessorCheckpoint,
  type AsyncRetryOptions,
  type CurrentMessageProcessorPosition,
} from '@event-driven-io/emmett';
import type { EventStoreDBClient } from '@eventstore/db-client';
import {
  END,
  excludeSystemEvents,
  START,
  type AllStreamSubscription,
  type StreamSubscription,
} from '@eventstore/db-client';
import {
  $all,
  type EventStoreDBEventStoreConsumerType,
} from '../eventStoreDBEventStoreConsumer';
export { readLastCommittedMessageCheckpoint } from './readLastCommittedMessageCheckpoint';

export const DefaultEventStoreDBEventStoreProcessorBatchSize = 100;

export type EventStoreDBSubscriptionStartFrom = CurrentMessageProcessorPosition;

export type EventStoreDBSubscription =
  AllStreamSubscription | StreamSubscription;

const toGlobalPosition = (startFrom: EventStoreDBSubscriptionStartFrom) =>
  startFrom === 'BEGINNING'
    ? START
    : startFrom === 'END'
      ? END
      : {
          prepare: parseBigIntProcessorCheckpoint(startFrom.lastCheckpoint),
          commit: parseBigIntProcessorCheckpoint(startFrom.lastCheckpoint),
        };

const toStreamPosition = (startFrom: EventStoreDBSubscriptionStartFrom) =>
  startFrom === 'BEGINNING'
    ? START
    : startFrom === 'END'
      ? END
      : parseBigIntProcessorCheckpoint(startFrom.lastCheckpoint);

export const subscribe = (
  client: EventStoreDBClient,
  from: EventStoreDBEventStoreConsumerType | undefined,
  startFrom: EventStoreDBSubscriptionStartFrom,
): EventStoreDBSubscription =>
  from == undefined || from.stream == $all
    ? client.subscribeToAll({
        ...(from?.options ?? {}),
        fromPosition: toGlobalPosition(startFrom),
        filter: excludeSystemEvents(),
      })
    : client.subscribeToStream(from.stream, {
        ...(from.options ?? {}),
        fromRevision: toStreamPosition(startFrom),
      });

export const isDatabaseUnavailableError = (error: unknown) =>
  error instanceof Error &&
  'type' in error &&
  error.type === 'unavailable' &&
  'code' in error &&
  error.code === 14;

export const EventStoreDBResubscribeDefaultOptions: AsyncRetryOptions = {
  forever: true,
  minTimeout: 100,
  factor: 1.5,
  shouldRetryError: (error) => !isDatabaseUnavailableError(error),
};
