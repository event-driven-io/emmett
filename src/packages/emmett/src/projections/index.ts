import type {
  AnyReadEventMetadata,
  CanHandle,
  DefaultRecord,
  Event,
  ReadEvent,
} from '../typing';

export type ProjectionHandlingType = 'inline' | 'async';

export type ProjectionHandler<
  EventType extends Event = Event,
  EventMetaDataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
> = (
  events: ReadEvent<EventType, EventMetaDataType>[],
  context: ProjectionHandlerContext,
) => Promise<void> | void;

export interface ProjectionDefinition<
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
> {
  name?: string;
  canHandle: CanHandle<Event>;
  handle: ProjectionHandler<
    Event,
    ReadEventMetadataType,
    ProjectionHandlerContext
  >;
}

export interface TypedProjectionDefinition<
  EventType extends Event = Event,
  EventMetaDataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
> {
  name?: string;
  canHandle: CanHandle<EventType>;
  handle: ProjectionHandler<
    EventType,
    EventMetaDataType,
    ProjectionHandlerContext
  >;
}

export type ProjectionRegistration<
  HandlingType extends ProjectionHandlingType,
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
> = {
  type: HandlingType;
  projection: ProjectionDefinition<
    ReadEventMetadataType,
    ProjectionHandlerContext
  >;
};

export const projection = <
  EventType extends Event = Event,
  EventMetaDataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
  ProjectionDefintionType extends TypedProjectionDefinition<
    EventType,
    EventMetaDataType,
    ProjectionHandlerContext
  > = TypedProjectionDefinition<
    EventType,
    EventMetaDataType,
    ProjectionHandlerContext
  >,
>(
  definition: ProjectionDefintionType,
): ProjectionDefintionType => definition;

export const inlineProjections = <
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
  ProjectionDefintionType extends ProjectionDefinition<
    ReadEventMetadataType,
    ProjectionHandlerContext
  > = ProjectionDefinition<ReadEventMetadataType, ProjectionHandlerContext>,
>(
  definitions: ProjectionDefintionType[],
): ProjectionRegistration<
  'inline',
  ReadEventMetadataType,
  ProjectionHandlerContext
>[] => definitions.map((projection) => ({ type: 'inline', projection }));

export const asyncProjections = <
  ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
  ProjectionDefintionType extends ProjectionDefinition<
    ReadEventMetadataType,
    ProjectionHandlerContext
  > = ProjectionDefinition<ReadEventMetadataType, ProjectionHandlerContext>,
>(
  definitions: ProjectionDefintionType[],
): ProjectionRegistration<
  'async',
  ReadEventMetadataType,
  ProjectionHandlerContext
>[] => definitions.map((projection) => ({ type: 'async', projection }));

export const projections = {
  inline: inlineProjections,
  async: asyncProjections,
};
