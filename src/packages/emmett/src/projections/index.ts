import { EmmettError } from '../errors';
import { JSONParser } from '../serialization';
import type {
  AnyReadEventMetadata,
  CanHandle,
  DefaultRecord,
  Event,
  ReadEvent,
} from '../typing';
import { arrayUtils } from '../utils';

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
