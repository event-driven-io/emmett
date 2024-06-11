import { v4 as randomUUID } from 'uuid';
import {
  TransformStream,
  TransformStreamDefaultController,
} from 'web-streams-polyfill';
import type {
  Event,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from '../typing';
import {
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResult,
  type DefaultStreamVersionType,
  type EventStore,
  type ReadStreamOptions,
  type ReadStreamResult,
} from './eventStore';
import type { GlobalStreamCaughtUp, GlobalSubscriptionEvent } from './events';
import { assertExpectedVersionMatchesCurrent } from './expectedVersion';

export type EventHandler<E extends Event = Event> = (
  eventEnvelope: ReadEvent<E>,
) => void;

export const getInMemoryEventStore = (): EventStore<
  DefaultStreamVersionType,
  ReadEventMetadataWithGlobalPosition
> => {
  const streams = new Map<
    string,
    ReadEvent<Event, ReadEventMetadataWithGlobalPosition>[]
  >();
  const subscriptions = SubscriptionsCoordinator();

  const getAllEventsCount = () => {
    return Array.from<ReadEvent[]>(streams.values())
      .map((s) => s.length)
      .reduce((p, c) => p + c, 0);
  };

  return {
    async aggregateStream<State, EventType extends Event>(
      streamName: string,
      options: AggregateStreamOptions<State, EventType>,
    ): Promise<AggregateStreamResult<State> | null> {
      const { evolve, initialState, read } = options;

      const result = await this.readStream<EventType>(streamName, read);

      if (!result) return null;

      const events = result?.events ?? [];

      return {
        currentStreamVersion: BigInt(events.length),
        state: events.reduce(evolve, initialState()),
      };
    },

    readStream: <EventType extends Event>(
      streamName: string,
      options?: ReadStreamOptions,
    ): Promise<
      ReadStreamResult<
        EventType,
        DefaultStreamVersionType,
        ReadEventMetadataWithGlobalPosition
      >
    > => {
      const events = streams.get(streamName);
      const currentStreamVersion = events ? BigInt(events.length) : undefined;

      assertExpectedVersionMatchesCurrent(
        currentStreamVersion,
        options?.expectedStreamVersion,
      );

      const from = Number(options && 'from' in options ? options.from : 0);
      const to = Number(
        options && 'to' in options
          ? options.to
          : options && 'maxCount' in options && options.maxCount
            ? options.from + options.maxCount
            : (events?.length ?? 1),
      );

      const resultEvents =
        events && events.length > 0
          ? events
              .map(
                (e) =>
                  e as ReadEvent<
                    EventType,
                    ReadEventMetadataWithGlobalPosition
                  >,
              )
              .slice(from, to)
          : [];

      const result: ReadStreamResult<
        EventType,
        DefaultStreamVersionType,
        ReadEventMetadataWithGlobalPosition
      > =
        events && events.length > 0
          ? {
              currentStreamVersion: currentStreamVersion!,
              events: resultEvents,
            }
          : null;

      return Promise.resolve(result);
    },

    appendToStream: async <EventType extends Event>(
      streamName: string,
      events: EventType[],
      options?: AppendToStreamOptions,
    ): Promise<AppendToStreamResult> => {
      const currentEvents = streams.get(streamName) ?? [];
      const currentStreamVersion =
        currentEvents.length > 0 ? BigInt(currentEvents.length) : undefined;

      assertExpectedVersionMatchesCurrent(
        currentStreamVersion,
        options?.expectedStreamVersion,
      );

      const newEvents: ReadEvent<
        EventType,
        ReadEventMetadataWithGlobalPosition
      >[] = events.map((event, index) => {
        return {
          ...event,
          metadata: {
            ...(event.metadata ?? {}),
            streamName,
            eventId: randomUUID(),
            streamPosition: BigInt(currentEvents.length + index + 1),
            globalPosition: BigInt(getAllEventsCount() + index + 1),
          },
        };
      });

      const positionOfLastEventInTheStream = BigInt(
        newEvents.slice(-1)[0]!.metadata.streamPosition,
      );

      streams.set(streamName, [...currentEvents, ...newEvents]);
      await subscriptions.notify(newEvents);

      const result: AppendToStreamResult = {
        nextExpectedStreamVersion: positionOfLastEventInTheStream,
      };

      return result;
    },

    subscribe: subscriptions.subscribe,
  };
};

export const SubscriptionsCoordinator = () => {
  const allEvents: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>[] = [];
  const subscribers = new Set<CaughtUpTransformStream>();

  return {
    notify: async (
      events: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>[],
    ) => {
      allEvents.push(...events);

      for (const subscriber of subscribers) {
        const writableStream = subscriber.writable;
        const writer = writableStream.getWriter();
        for (const event of events) await writer.write(event);
      }
    },

    subscribe: () => {
      const transformStream = new CaughtUpTransformStream(
        allEvents,
        (subscription) => {
          subscribers.delete(subscription);
        },
      );

      subscribers.add(transformStream);
      return transformStream.readable;
    },
  };
};

export class CaughtUpTransformStream extends TransformStream<
  ReadEvent<Event, ReadEventMetadataWithGlobalPosition>,
  | ReadEvent<Event, ReadEventMetadataWithGlobalPosition>
  | GlobalSubscriptionEvent
> {
  private currentGlobalPosition: bigint;
  private highestGlobalPosition: bigint;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(
    events: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>[],
    private onNoActiveReaderCallback: (stream: CaughtUpTransformStream) => void,
  ) {
    super({
      start: (controller) => {
        let globalPosition = 0n;
        for (const event of events) {
          controller.enqueue(event);
          globalPosition = event.metadata.globalPosition;
        }
        CaughtUpTransformStream.enqueueCaughtUpEvent(
          controller,
          globalPosition,
          globalPosition,
        );
      },
      transform: (event, controller) => {
        this.currentGlobalPosition = event.metadata.globalPosition;
        controller.enqueue(event);
        CaughtUpTransformStream.enqueueCaughtUpEvent(
          controller,
          this.currentGlobalPosition,
          this.highestGlobalPosition,
        );
      },
      cancel: (reason) => {
        console.log('Stream was canceled. Reason:', reason);
        this.stopChecking();
        this.checkNoActiveReader();
      },
    });

    this.currentGlobalPosition = this.highestGlobalPosition =
      events.length > 0
        ? events[events.length - 1]!.metadata.globalPosition
        : 0n;

    this.onNoActiveReaderCallback = onNoActiveReaderCallback;

    // Start checking for no active readers
    this.startChecking();
  }

  private startChecking() {
    this.checkInterval = setInterval(() => {
      this.checkNoActiveReader();
    }, 20); // Adjust the interval as needed
  }

  private stopChecking() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  private checkNoActiveReader() {
    // Check if the readable stream has no active reader
    if (!this.readable.locked) {
      this.stopChecking();
      this.onNoActiveReaderCallback(this);
    }
  }

  private static enqueueCaughtUpEvent(
    controller: TransformStreamDefaultController<
      | ReadEvent<Event, ReadEventMetadataWithGlobalPosition>
      | GlobalSubscriptionEvent
    >,
    currentGlobalPosition: bigint,
    highestGlobalPosition: bigint,
  ) {
    if (currentGlobalPosition < highestGlobalPosition) return;

    const caughtUp: GlobalStreamCaughtUp = {
      type: '__emt:GlobalStreamCaughtUp',
      data: {
        globalPosition: highestGlobalPosition,
      },
    };
    controller.enqueue(caughtUp);
  }
}
