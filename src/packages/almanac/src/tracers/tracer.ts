import { noopSpan, type ActiveSpan, type StartSpanOptions } from './span';

export type TracePropagation = 'links' | 'propagate';

export type Tracer = {
  startSpan<T>(
    name: string,
    fn: (span: ActiveSpan) => Promise<T>,
    options?: StartSpanOptions,
  ): Promise<T>;
};

export const noopTracer = (): Tracer => ({
  startSpan: async (_name, fn, _options?) => fn(noopSpan),
});
