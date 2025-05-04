import { EmmettError } from '../errors';
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
  EventType extends AnyEvent = AnyEvent,
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

export interface ProjectionDefinition<
  EventType extends AnyEvent = AnyEvent,
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
  truncate?: TruncateProjection<ProjectionHandlerContext>;
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
  EventType extends AnyEvent = Event,
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
