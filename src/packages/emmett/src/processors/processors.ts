import type { EmmettError } from '../errors';
import type { ProjectionDefinition } from '../projections';
import {
  type AnyMessage,
  type AnyReadEventMetadata,
  type Event,
  type MessageHandler,
  type MessageHandlerResult,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type RecordedMessage,
} from '../typing';

export type CurrentMessageProcessorPosition<
  Position = { globalPosition: bigint },
> = Position | 'BEGINNING' | 'END';

export type MessageProcessor<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetaDataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  MessageProcessorStartOptions = unknown,
> = {
  id: string;
  start: (
    options: MessageProcessorStartOptions,
  ) => Promise<CurrentMessageProcessorPosition | undefined>;
  isActive: boolean;
  handle: MessageHandler<MessageType, MessageMetaDataType>;
};

export const MessageProcessor = {
  result: {
    skip: (options?: { reason?: string }): MessageHandlerResult => ({
      type: 'SKIP',
      ...(options ?? {}),
    }),
    stop: (options?: {
      reason?: string;
      error?: EmmettError;
    }): MessageHandlerResult => ({
      type: 'STOP',
      ...(options ?? {}),
    }),
  },
};

export type MessageProcessorStartFrom =
  | CurrentMessageProcessorPosition
  | 'CURRENT';

export type ProjectionProcessorOptions<EventType extends Event = Event> = {
  processorId?: string;
  version?: number;
  projection: ProjectionDefinition<EventType>;
  partition?: string;
  startFrom?: MessageProcessorStartFrom;
  stopAfter?: (
    message: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
  ) => boolean;
};

export type GenericMessageProcessorOptions<
  MessageType extends AnyMessage = AnyMessage,
  MessageMetaDataType extends AnyReadEventMetadata = AnyReadEventMetadata,
> = {
  processorId: string;
  version?: number;
  partition?: string;
  startFrom?: MessageProcessorStartFrom;
  stopAfter?: (
    message: RecordedMessage<MessageType, MessageMetaDataType>,
  ) => boolean;
} & (
  | {
      eachMessage: MessageHandler<MessageType, MessageMetaDataType>;
    }
  | { eachBatch: MessageHandler<MessageType, MessageMetaDataType> }
);

// export type MessageProcessorOptions<EventType extends Event = Event> =
//   | GenericMessageProcessorOptions<EventType>
//   | ProjectionProcessorOptions<EventType>;

// const genericMessageProcessor = <EventType extends Event = Event>(
//   options: GenericMessageProcessorOptions<EventType>,
// ): MessageProcessor => {
//   const { eachMessage } = options;
//   let isActive = true;
//   //let lastProcessedPosition: bigint | null = null;

//   const poolOptions = {
//     ...(options.connectionOptions ? options.connectionOptions : {}),
//   };
//   const processorConnectionString =
//     'connectionString' in poolOptions ? poolOptions.connectionString : null;

//   const processorPool =
//     'dumbo' in poolOptions
//       ? (poolOptions.dumbo as NodePostgresPool)
//       : processorConnectionString
//         ? dumbo({
//             connectionString: processorConnectionString,
//             ...poolOptions,
//           })
//         : null;

//   const getPool = (context: {
//     pool?: Dumbo;
//     connectionString?: string;
//   }): { pool: Dumbo; connectionString: string } => {
//     const connectionString =
//       processorConnectionString ?? context.connectionString;

//     if (!connectionString)
//       throw new EmmettError(
//         `PostgreSQL processor '${options.processorId}' is missing connection string. Ensure that you passed it through options`,
//       );

//     const pool =
//       (!processorConnectionString ||
//       connectionString == processorConnectionString
//         ? context?.pool
//         : processorPool) ?? processorPool;

//     if (!pool)
//       throw new EmmettError(
//         `PostgreSQL processor '${options.processorId}' is missing connection string. Ensure that you passed it through options`,
//       );

//     return {
//       connectionString,
//       pool: pool,
//     };
//   };

//   return {
//     id: options.processorId,
//     start: async (
//       execute: SQLExecutor,
//     ): Promise<CurrentMessageProcessorPosition | undefined> => {
//       isActive = true;
//       if (options.startFrom !== 'CURRENT') return options.startFrom;

//       const { lastProcessedPosition } = await readProcessorCheckpoint(execute, {
//         processorId: options.processorId,
//         partition: options.partition,
//       });

//       if (lastProcessedPosition === null) return 'BEGINNING';

//       return { globalPosition: lastProcessedPosition };
//     },
//     get isActive() {
//       return isActive;
//     },
//     handle: async (
//       { messages },
//       context,
//     ): Promise<MessageProcessorMessageHandlerResult> => {
//       if (!isActive) return;

//       const { pool, connectionString } = getPool(context);

//       return pool.withTransaction(async (transaction) => {
//         let result: MessageProcessorMessageHandlerResult | undefined =
//           undefined;

//         let lastProcessedPosition: bigint | null = null;

//         for (const message of messages) {
//           const typedMessage = message as ReadEvent<
//             EventType,
//             ReadEventMetadataWithGlobalPosition
//           >;

//           const client =
//             (await transaction.connection.open()) as NodePostgresClient;

//           const messageProcessingResult = await eachMessage(typedMessage, {
//             execute: transaction.execute,
//             connection: {
//               connectionString,
//               pool,
//               transaction: transaction,
//               client,
//             },
//           });

//           // TODO: Add correct handling of the storing checkpoint
//           await storeProcessorCheckpoint(transaction.execute, {
//             processorId: options.processorId,
//             version: options.version,
//             lastProcessedPosition,
//             newPosition: typedMessage.metadata.globalPosition,
//             partition: options.partition,
//           });

//           lastProcessedPosition = typedMessage.metadata.globalPosition;

//           if (
//             messageProcessingResult &&
//             messageProcessingResult.type === 'STOP'
//           ) {
//             isActive = false;
//             result = messageProcessingResult;
//             break;
//           }

//           if (options.stopAfter && options.stopAfter(typedMessage)) {
//             isActive = false;
//             result = { type: 'STOP', reason: 'Stop condition reached' };
//             break;
//           }

//           if (
//             messageProcessingResult &&
//             messageProcessingResult.type === 'SKIP'
//           )
//             continue;
//         }

//         return result;
//       });
//     },
//   };
// };

// export const projectionProcessor = <EventType extends Event = Event>(
//   options: ProjectionProcessorOptions<EventType>,
// ): MessageProcessor => {
//   const projection = options.projection;

//   return genericMessageProcessor<EventType>({
//     processorId: options.processorId ?? `projection:${projection.name}`,
//     eachMessage: async (event, context) => {
//       if (!projection.canHandle.includes(event.type)) return;

//       await projection.handle([event], context);
//     },
//     ...options,
//   });
// };

// export const messageProcessor = <EventType extends Event = Event>(
//   options: MessageProcessorOptions<EventType>,
// ): MessageProcessor => {
//   if ('projection' in options) {
//     return projectionProcessor(options);
//   }

//   return genericMessageProcessor(options);
// };
