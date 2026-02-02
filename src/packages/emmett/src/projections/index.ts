import { EmmettError } from '../errors';
import type { EventStoreReadSchemaOptions } from '../eventStore';
import { JSONParser } from '../serialization';
import type {
  AnyEvent,
  AnyReadEventMetadata,
  BatchRecordedMessageHandlerWithContext,
  CanHandle,
  DefaultRecord,
  Event,
} from '../typing';
import { arrayUtils } from '../utils';

export type ProjectionHandlingType = 'inline' | 'async';

export type ProjectionHandler<
  EventType extends Event = AnyEvent,
  EventMetaDataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
> = BatchRecordedMessageHandlerWithContext<
  EventType,
  EventMetaDataType,
  ProjectionHandlerContext
>;

export type TruncateProjection<
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
> = (context: ProjectionHandlerContext) => Promise<void>;

export type ProjectionInitOptions<
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
> = {
  version: number;
  status?: 'active' | 'inactive';
  registrationType: ProjectionHandlingType;
  context: ProjectionHandlerContext;
};

export interface ProjectionDefinition<
  EventType extends Event = AnyEvent,
  EventMetaDataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
  EventPayloadType extends Event = EventType,
> {
  name?: string;
  version?: number;
  kind?: string;
  canHandle: CanHandle<EventType>;
  handle: ProjectionHandler<
    EventType,
    EventMetaDataType,
    ProjectionHandlerContext
  >;
  truncate?: TruncateProjection<ProjectionHandlerContext>;
  init?: (
    options: ProjectionInitOptions<ProjectionHandlerContext>,
  ) => void | Promise<void>;
  eventsOptions?: {
    schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
  };
}

export type ProjectionRegistration<
  HandlingType extends ProjectionHandlingType,
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
> = {
  type: HandlingType;
  projection: ProjectionDefinition<
    AnyEvent,
    ReadEventMetadataType,
    ProjectionHandlerContext,
    AnyEvent
  >;
};

export const filterProjections = <
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
>(
  type: ProjectionHandlingType,
  projections: ProjectionRegistration<
    ProjectionHandlingType,
    ReadEventMetadataType,
    ProjectionHandlerContext
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
      ${JSONParser.stringify(duplicateRegistrations)}
      have different names`);
  }

  return inlineProjections;
};

export const projection = <
  EventType extends Event = Event,
  EventMetaDataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
  EventPayloadType extends Event = EventType,
>(
  definition: ProjectionDefinition<
    EventType,
    EventMetaDataType,
    ProjectionHandlerContext,
    EventPayloadType
  >,
): ProjectionDefinition<
  EventType,
  EventMetaDataType,
  ProjectionHandlerContext,
  EventPayloadType
> => definition;

export const inlineProjections = <
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
>(
  definitions: ProjectionDefinition<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any,
    ReadEventMetadataType,
    ProjectionHandlerContext
  >[],
): ProjectionRegistration<
  'inline',
  ReadEventMetadataType,
  ProjectionHandlerContext
>[] =>
  definitions.map((definition) => ({
    type: 'inline',
    projection: definition,
  }));

export const asyncProjections = <
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
>(
  definitions: ProjectionDefinition<
    AnyEvent,
    ReadEventMetadataType,
    ProjectionHandlerContext
  >[],
): ProjectionRegistration<
  'inline',
  ReadEventMetadataType,
  ProjectionHandlerContext
>[] =>
  definitions.map((definition) => ({
    type: 'inline',
    projection: definition,
  }));

export const projections = {
  inline: inlineProjections,
  async: asyncProjections,
};
