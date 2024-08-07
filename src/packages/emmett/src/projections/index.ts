import type { DefaultRecord, Event, EventTypeOf, ReadEvent } from '../typing';

export type ProjectionHandler<
  EventType extends Event = Event,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
> = (
  events: ReadEvent<EventType>[],
  context: ProjectionHandlerContext,
) => Promise<void> | void;

export interface ProjectionDefintion<
  ProjectionType extends 'inline' | 'async',
  EventType extends Event = Event,
  ProjectionHandlerContext extends DefaultRecord = DefaultRecord,
> {
  type: ProjectionType;
  name?: string;
  canHandle: EventTypeOf<EventType>[];
  handle: ProjectionHandler<EventType, ProjectionHandlerContext>;
}
