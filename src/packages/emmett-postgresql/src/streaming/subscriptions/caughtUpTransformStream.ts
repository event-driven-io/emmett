import type {
  Event,
  GlobalPosition,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import {
  bigIntProcessorCheckpoint,
  globalStreamCaughtUp,
  type GlobalSubscriptionEvent,
} from '@event-driven-io/emmett';
import { TransformStream } from 'node:stream/web';

export const streamTrackingGlobalPosition = (
  currentEvents: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>[],
) => new CaughtUpTransformStream(currentEvents);

export class CaughtUpTransformStream extends TransformStream<
  ReadEvent<Event, ReadEventMetadataWithGlobalPosition>,
  | ReadEvent<Event, ReadEventMetadataWithGlobalPosition>
  | GlobalSubscriptionEvent
> {
  private _currentPosition: GlobalPosition;
  private _logPosition: GlobalPosition;

  constructor(events: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>[]) {
    super({
      start: (controller) => {
        let globalPosition: GlobalPosition = bigIntProcessorCheckpoint(0n);
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
        : bigIntProcessorCheckpoint(0n);
  }

  public set logPosition(value: GlobalPosition) {
    this._logPosition = value;
  }
}
