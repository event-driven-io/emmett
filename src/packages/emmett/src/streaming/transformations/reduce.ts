import { TransformStream } from 'web-streams-polyfill';

export const reduce = <I, O>(
  reducer: (accumulator: O, chunk: I) => O,
  initialValue: O,
) => new ReduceTransformStream<I, O>(reducer, initialValue);

export class ReduceTransformStream<I, O> extends TransformStream<I, O> {
  private accumulator: O;
  private reducer: (accumulator: O, chunk: I) => O;

  constructor(reducer: (accumulator: O, chunk: I) => O, initialValue: O) {
    super({
      transform: (chunk) => {
        this.accumulator = this.reducer(this.accumulator, chunk);
      },
      flush: (controller) => {
        controller.enqueue(this.accumulator);
        controller.terminate();
      },
    });

    this.accumulator = initialValue;
    this.reducer = reducer;
  }
}
