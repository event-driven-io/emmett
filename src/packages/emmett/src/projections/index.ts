import { EmmettError } from '../errors';
import type { EventStoreReadSchemaOptions } from '../eventStore';
import {
  JSONSerializer,
  type JSONSerializationOptions,
} from '../serialization';
import type {
  AnyEvent,
  AnyReadEventMetadata,
  BatchRecordedMessageHandlerWithContext,
  CanHandle,
  DefaultRecord,
  Event,
  HandlerContextRoot,
  MessageHandlerContext,
} from '../typing';
import { arrayUtils } from '../utils';

export type ProjectionHandlingType = 'inline' | 'async';

export type ProjectionHandlerContext<
  HandlerContext extends HandlerContextRoot = Record<never, never>,
  Session extends DefaultRecord = DefaultRecord,
> = MessageHandlerContext<HandlerContext, Session>;

export type ProjectionHandler<
  EventType extends Event = AnyEvent,
  EventMetaDataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends ProjectionHandlerContext = ProjectionHandlerContext,
> = BatchRecordedMessageHandlerWithContext<
  EventType,
  EventMetaDataType,
  HandlerContext
>;

export type TruncateProjection<
  HandlerContext extends ProjectionHandlerContext = ProjectionHandlerContext,
> = (context: HandlerContext) => Promise<void>;

export type ProjectionInitOptions<
  HandlerContext extends ProjectionHandlerContext = ProjectionHandlerContext,
> = {
  version: number;
  status?: 'active' | 'inactive';
  registrationType: ProjectionHandlingType;
  context: HandlerContext;
};

export type ProjectionDefinition<
  EventType extends Event = AnyEvent,
  EventMetaDataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends ProjectionHandlerContext = ProjectionHandlerContext,
  EventPayloadType extends Event = EventType,
  Schema = unknown,
  InitContext extends ProjectionHandlerContext = HandlerContext,
> = {
  name?: string;
  version?: number;
  kind?: string;
  schema?: Schema;
  canHandle: CanHandle<EventType>;
  handle: ProjectionHandler<EventType, EventMetaDataType, HandlerContext>;
  truncate?: TruncateProjection<HandlerContext>;
  init?: (options: ProjectionInitOptions<InitContext>) => void | Promise<void>;
  eventsOptions?: {
    schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
  };
} & JSONSerializationOptions;

export type ProjectionRegistration<
  HandlingType extends ProjectionHandlingType,
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends ProjectionHandlerContext = ProjectionHandlerContext,
  Schema = unknown,
  InitContext extends ProjectionHandlerContext = HandlerContext,
> = {
  type: HandlingType;
  projection: ProjectionDefinition<
    AnyEvent,
    ReadEventMetadataType,
    HandlerContext,
    AnyEvent,
    Schema,
    InitContext
  >;
};

export const filterProjections = <
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends ProjectionHandlerContext = ProjectionHandlerContext,
>(
  type: ProjectionHandlingType,
  projections: ProjectionRegistration<
    ProjectionHandlingType,
    ReadEventMetadataType,
    HandlerContext
  >[],
) => {
  const inlineProjections = projections
    .filter((projection) => projection.type === type)
    .map(({ projection }) => projection);

  const duplicateRegistrations = arrayUtils.getDuplicates(
    inlineProjections,
    (proj) => proj.name,
  );

  if (duplicateRegistrations.length > 0) {
    throw new EmmettError(`You cannot register multiple projections with the same name (or without the name).
      Ensure that:
      ${JSONSerializer.serialize(duplicateRegistrations)}
      have different names`);
  }

  return inlineProjections;
};

export const projection = <
  EventType extends Event = Event,
  EventMetaDataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends ProjectionHandlerContext = ProjectionHandlerContext,
  EventPayloadType extends Event = EventType,
  Schema = unknown,
  InitContext extends ProjectionHandlerContext = HandlerContext,
>(
  definition: ProjectionDefinition<
    EventType,
    EventMetaDataType,
    HandlerContext,
    EventPayloadType,
    Schema,
    InitContext
  >,
): ProjectionDefinition<
  EventType,
  EventMetaDataType,
  HandlerContext,
  EventPayloadType,
  Schema,
  InitContext
> => definition;

export const inlineProjections = <
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends ProjectionHandlerContext = ProjectionHandlerContext,
  Schema = unknown,
  InitContext extends ProjectionHandlerContext = HandlerContext,
>(
  definitions: ProjectionDefinition<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any,
    ReadEventMetadataType,
    HandlerContext,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any,
    Schema,
    InitContext
  >[],
): ProjectionRegistration<
  'inline',
  ReadEventMetadataType,
  HandlerContext,
  Schema,
  InitContext
>[] =>
  definitions.map((definition) => ({
    type: 'inline',
    projection: definition,
  }));

export const asyncProjections = <
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends ProjectionHandlerContext = ProjectionHandlerContext,
  Schema = unknown,
  InitContext extends ProjectionHandlerContext = HandlerContext,
>(
  definitions: ProjectionDefinition<
    AnyEvent,
    ReadEventMetadataType,
    HandlerContext,
    AnyEvent,
    Schema,
    InitContext
  >[],
): ProjectionRegistration<
  'async',
  ReadEventMetadataType,
  HandlerContext,
  Schema,
  InitContext
>[] =>
  definitions.map((definition) => ({
    type: 'async',
    projection: definition,
  }));

export const projections = {
  inline: inlineProjections,
  async: asyncProjections,
};
