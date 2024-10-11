import streams from '@event-driven-io/emmett-shims';
import { v4 as uuid } from 'uuid';

export const notifyAboutNoActiveReadersStream = <Item>(
  onNoActiveReaderCallback: (
    stream: NotifyAboutNoActiveReadersStream<Item>,
  ) => void,
  options: { streamId?: string; intervalCheckInMs?: number } = {},
) => new NotifyAboutNoActiveReadersStream(onNoActiveReaderCallback, options);

export class NotifyAboutNoActiveReadersStream<
  Item,
> extends streams.TransformStream<Item, Item> {
  private checkInterval: NodeJS.Timeout | null = null;
  public readonly streamId: string;
  private _isStopped: boolean = false;
  public get hasActiveSubscribers() {
    return !this._isStopped;
  }

  constructor(
    private onNoActiveReaderCallback: (
      stream: NotifyAboutNoActiveReadersStream<Item>,
    ) => void,
    options: { streamId?: string; intervalCheckInMs?: number } = {},
  ) {
    super({
      cancel: (reason) => {
        console.log('Stream was canceled. Reason:', reason);
        this.stopChecking();
      },
    });
    this.streamId = options?.streamId ?? uuid();

    this.onNoActiveReaderCallback = onNoActiveReaderCallback;

    this.startChecking(options?.intervalCheckInMs ?? 20);
  }

  private startChecking(interval: number) {
    this.checkInterval = setInterval(() => {
      this.checkNoActiveReader();
    }, interval);
  }

  private stopChecking() {
    if (!this.checkInterval) return;

    clearInterval(this.checkInterval);
    this.checkInterval = null;
    this._isStopped = true;
    this.onNoActiveReaderCallback(this);
  }

  private checkNoActiveReader() {
    if (!this.readable.locked && !this._isStopped) {
      this.stopChecking();
    }
  }
}
