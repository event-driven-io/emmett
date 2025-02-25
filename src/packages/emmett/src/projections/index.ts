import { EmmettError } from '../errors';
import { JSONParser } from '../serialization';
import type {
  AnyEvent,
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
    AnyEvent,
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
>(
  definition: ProjectionDefinition<
    EventType,
    EventMetaDataType,
    ProjectionHandlerContext
  >,
): ProjectionDefinition<
  EventType,
  EventMetaDataType,
  ProjectionHandlerContext
> => definition;

export const inlineProjections = <
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
