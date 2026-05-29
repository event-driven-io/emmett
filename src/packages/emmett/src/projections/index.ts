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
  MessageHandlerContext,
} from '../typing';
import { arrayUtils } from '../utils';

export type ProjectionHandlingType = 'inline' | 'async';

export type ProjectionHandlerContext<
  HandlerContext extends DefaultRecord = DefaultRecord,
> = MessageHandlerContext<HandlerContext>;

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
> = {
  name?: string;
  version?: number;
  kind?: string;
  canHandle: CanHandle<EventType>;
  handle: ProjectionHandler<EventType, EventMetaDataType, HandlerContext>;
  truncate?: TruncateProjection<HandlerContext>;
  init?: (
    options: ProjectionInitOptions<HandlerContext>,
  ) => void | Promise<void>;
  eventsOptions?: {
    schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
  };
} & JSONSerializationOptions;

export type ProjectionRegistration<
  HandlingType extends ProjectionHandlingType,
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends ProjectionHandlerContext = ProjectionHandlerContext,
> = {
  type: HandlingType;
  projection: ProjectionDefinition<
    AnyEvent,
    ReadEventMetadataType,
    HandlerContext,
    AnyEvent
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
>(
  definition: ProjectionDefinition<
    EventType,
    EventMetaDataType,
    HandlerContext,
    EventPayloadType
  >,
): ProjectionDefinition<
  EventType,
  EventMetaDataType,
  HandlerContext,
  EventPayloadType
> => definition;

export const inlineProjections = <
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends ProjectionHandlerContext = ProjectionHandlerContext,
>(
  definitions: ProjectionDefinition<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any,
    ReadEventMetadataType,
    HandlerContext
  >[],
): ProjectionRegistration<'inline', ReadEventMetadataType, HandlerContext>[] =>
  definitions.map((definition) => ({
    type: 'inline',
    projection: definition,
  }));

export const asyncProjections = <
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  HandlerContext extends ProjectionHandlerContext = ProjectionHandlerContext,
>(
  definitions: ProjectionDefinition<
    AnyEvent,
    ReadEventMetadataType,
    HandlerContext
  >[],
): ProjectionRegistration<'inline', ReadEventMetadataType, HandlerContext>[] =>
  definitions.map((definition) => ({
    type: 'inline',
    projection: definition,
  }));

export const projections = {
  inline: inlineProjections,
  async: asyncProjections,
};
