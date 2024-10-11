import streams from '@event-driven-io/emmett-shims';
import type {
  Event,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from '../../typing';
import { globalStreamCaughtUp, type GlobalSubscriptionEvent } from '../events';

export const streamTrackingGlobalPosition = (
  currentEvents: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>[],
) => new CaughtUpTransformStream(currentEvents);

export class CaughtUpTransformStream extends streams.TransformStream<
  ReadEvent<Event, ReadEventMetadataWithGlobalPosition>,
  | ReadEvent<Event, ReadEventMetadataWithGlobalPosition>
  | GlobalSubscriptionEvent
> {
  private _currentPosition: bigint;
  private _logPosition: bigint;

  constructor(events: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>[]) {
    super({
      start: (controller) => {
        let globalPosition = 0n;
        for (const event of events) {
          controller.enqueue(event);
          globalPosition = event.metadata.globalPosition;
        }
        controller.enqueue(globalStreamCaughtUp({ globalPosition }));
      },
      transform: (event, controller) => {
        this._currentPosition = event.metadata.globalPosition;
        controller.enqueue(event);

        if (this._currentPosition < this._logPosition) return;

        controller.enqueue(
          globalStreamCaughtUp({ globalPosition: this._currentPosition }),
        );
      },
    });

    this._currentPosition = this._logPosition =
      events.length > 0
        ? events[events.length - 1]!.metadata.globalPosition
        : 0n;
  }

  public set logPosition(value: bigint) {
    this._logPosition = value;
  }
}
