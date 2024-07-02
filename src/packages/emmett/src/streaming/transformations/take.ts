import streams from '@event-driven-io/emmett-shims';

export const take = <T>(limit: number) => new TakeTransformStream<T>(limit);

export class TakeTransformStream<T> extends streams.TransformStream<T, T> {
  private count = 0;
  private limit: number;

  constructor(limit: number) {
    super({
      transform: (chunk, controller) => {
        if (this.count < this.limit) {
          this.count++;
          controller.enqueue(chunk);
        } else {
          controller.terminate();
        }
      },
    });

    this.limit = limit;
  }
}
