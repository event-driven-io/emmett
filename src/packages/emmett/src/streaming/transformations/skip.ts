import streams from '@event-driven-io/emmett-shims';

export const skip = <T>(limit: number) => new SkipTransformStream<T>(limit);

export class SkipTransformStream<T> extends streams.TransformStream<T, T> {
  private count = 0;
  private skip: number;

  constructor(skip: number) {
    super({
      transform: (chunk, controller) => {
        this.count++;
        if (this.count > this.skip) {
          controller.enqueue(chunk);
        }
      },
    });

    this.skip = skip;
  }
}
