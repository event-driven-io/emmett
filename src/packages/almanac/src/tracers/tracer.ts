import { noopSpan, type ActiveSpan, type StartSpanOptions } from './span';

export type TracePropagation = 'links' | 'propagate';

export type Tracer = {
  startSpan<T>(
    name: string,
    fn: (span: ActiveSpan) => Promise<T>,
    options?: StartSpanOptions,
  ): Promise<T>;
};

const noTracing: Tracer = {
  startSpan: async (_name, fn, _options?) => fn(noopSpan),
};

export const noopTracer = (): Tracer => noTracing;
