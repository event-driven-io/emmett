// import type { Event } from '../typing';
// import {
//   NO_CONCURRENCY_CHECK,
//   type AppendToStreamOptions,
//   type AppendToStreamResult,
//   type DefaultStreamVersionType,
//   type EventStore,
//   type ReadStreamOptions,
//   type ReadStreamResult,
// } from './eventStore';

// export type EventMetadata = Readonly<{
//   eventId: string;
//   streamPosition: number;
//   logPosition: bigint;
// }>;

// export type EventEnvelope<E extends Event = Event> = E & {
//   metadata: EventMetadata;
// };

// export type EventHandler<E extends Event = Event> = (
//   eventEnvelope: EventEnvelope<E>,
// ) => void;

// export const getEventStore = <
//   StreamVersion = DefaultStreamVersionType,
// >(): EventStore<StreamVersion> => {
//   const streams = new Map<string, EventEnvelope[]>();
//   const handlers: EventHandler[] = [];

//   const getAllEventsCount = () => {
//     return Array.from<EventEnvelope[]>(streams.values())
//       .map((s) => s.length)
//       .reduce((p, c) => p + c, 0);
//   };

//   return {
//     // aggregateStream<State, EventType extends Event>(
//     //   streamName: string,
//     //   options: AggregateStreamOptions<State, EventType, StreamVersion>,
//     // ): Promise<AggregateStreamResult<State, StreamVersion>>;

//     readStream: <EventType extends Event>(
//       streamName: string,
//       options?: ReadStreamOptions<StreamVersion>,
//     ): Promise<ReadStreamResult<EventType, StreamVersion>> => {
//       const events = streams.get(streamName);
//       const currentStreamVersion = events?.length;

//       const expectedStreamVersion =
//         options?.expectedStreamVersion ?? NO_CONCURRENCY_CHECK;

//       return Promise.resolve({ currentStreamVersion, events });
//     },

//     appendToStream: <EventType extends Event>(
//       streamId: string,
//       events: EventType[],
//       options?: AppendToStreamOptions<StreamVersion>,
//     ): Promise<AppendToStreamResult<StreamVersion>> => {
//       const current = streams.get(streamId) ?? [];

//       const eventEnvelopes: EventEnvelope[] = events.map((event, index) => {
//         return {
//           ...event,
//           metadata: {
//             eventId: uuid(),
//             streamPosition: current.length + index + 1,
//             logPosition: BigInt(getAllEventsCount() + index + 1),
//           },
//         };
//       });

//       streams.set(streamId, [...current, ...eventEnvelopes]);

//       for (const eventEnvelope of eventEnvelopes) {
//         for (const handler of handlers) {
//           handler(eventEnvelope);
//         }
//       }
//     },
//     subscribe: <E extends Event>(eventHandler: EventHandler<E>): void => {
//       handlers.push((eventEnvelope) =>
//         eventHandler(eventEnvelope as EventEnvelope<E>),
//       );
//     },
//   };
// };
