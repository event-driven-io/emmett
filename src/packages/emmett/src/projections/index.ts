import type { DefaultRecord, Event, EventTypeOf, ReadEvent } from '../typing';

export type ProjectionHandlingType = 'inline' | 'async';

export type ProjectionHandler<
  EventType extends Event = Event,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
> = (
  events: ReadEvent<EventType>[],
  context: ProjectionHandlerContext,
) => Promise<void> | void;

export interface ProjectionDefinition<
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
> {
  name?: string;
  canHandle: EventTypeOf<Event>[];
  handle: ProjectionHandler<Event, ProjectionHandlerContext>;
}

export interface TypedProjectionDefinition<
  EventType extends Event = Event,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
> {
  name?: string;
  canHandle: EventTypeOf<EventType>[];
  handle: ProjectionHandler<EventType, ProjectionHandlerContext>;
}

export type ProjectionRegistration<
  HandlingType extends ProjectionHandlingType,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
> = {
  type: HandlingType;
  projection: ProjectionDefinition<ProjectionHandlerContext>;
};

export const projection = <
  EventType extends Event = Event,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
  ProjectionDefintionType extends TypedProjectionDefinition<
    EventType,
    ProjectionHandlerContext
  > = ProjectionDefinition<ProjectionHandlerContext>,
>(
  definition: ProjectionDefintionType,
): ProjectionDefintionType => definition;

export const inlineProjections = <
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
  ProjectionDefintionType extends
    ProjectionDefinition<ProjectionHandlerContext> = ProjectionDefinition<ProjectionHandlerContext>,
>(
  definitions: ProjectionDefintionType[],
): ProjectionRegistration<'inline', ProjectionHandlerContext>[] =>
  definitions.map((projection) => ({ type: 'inline', projection }));

export const asyncProjections = <
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
  ProjectionDefintionType extends
    ProjectionDefinition<ProjectionHandlerContext> = ProjectionDefinition<ProjectionHandlerContext>,
>(
  definitions: ProjectionDefintionType[],
): ProjectionRegistration<'async', ProjectionHandlerContext>[] =>
  definitions.map((projection) => ({ type: 'async', projection }));

export const projections = {
  inline: inlineProjections,
  async: asyncProjections,
};
