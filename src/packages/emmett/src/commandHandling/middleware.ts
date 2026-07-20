export type AppendResult<Output> = { type: 'APPEND'; outputs: Output[] };
export type SkipResult<Output> = { type: 'SKIP'; outputs: Output[] };
export type StopResult<Output> = { type: 'STOP'; outputs: Output[] };
export type RejectResult<Output> = { type: 'REJECT'; outputs: Output[] };
export type AppendAndStopResult<Output> = {
  type: 'APPEND_AND_STOP';
  outputs: Output[];
};

export type DecisionHandlingResult<Output> =
  | AppendResult<Output>
  | SkipResult<Output>
  | StopResult<Output>
  | RejectResult<Output>
  | AppendAndStopResult<Output>;

export type Handler<Input, Context, Output> = (
  input: Input,
  context: Context,
) => Promise<DecisionHandlingResult<Output>>;

export type Middleware<Input, Context, Output> = (
  next: Handler<Input, Context, Output>,
) => Handler<Input, Context, Output>;

export type MiddlewareOptions<Input, Context, Output, BeforeAll, AfterAll> =
  | Middleware<Input, Context, Output>[]
  | {
      beforeAll?: BeforeAll;
      afterAll?: AfterAll;
      decision?: Middleware<Input, Context, Output>[];
    };

export const resolveMiddleware = <Input, Context, Output, BeforeAll, AfterAll>(
  middleware:
    MiddlewareOptions<Input, Context, Output, BeforeAll, AfterAll> | undefined,
): {
  beforeAll: BeforeAll | undefined;
  afterAll: AfterAll | undefined;
  decision: Middleware<Input, Context, Output>[] | undefined;
} =>
  Array.isArray(middleware)
    ? { beforeAll: undefined, afterAll: undefined, decision: middleware }
    : {
        beforeAll: middleware?.beforeAll,
        afterAll: middleware?.afterAll,
        decision: middleware?.decision,
      };

export const append = <Output>(outputs: Output[]): AppendResult<Output> => ({
  type: 'APPEND',
  outputs,
});
export const skip = <Output>(outputs: Output[]): SkipResult<Output> => ({
  type: 'SKIP',
  outputs,
});
export const stop = <Output>(outputs: Output[]): StopResult<Output> => ({
  type: 'STOP',
  outputs,
});
export const reject = <Output>(outputs: Output[]): RejectResult<Output> => ({
  type: 'REJECT',
  outputs,
});
export const appendAndStop = <Output>(
  outputs: Output[],
): AppendAndStopResult<Output> => ({ type: 'APPEND_AND_STOP', outputs });

export const DecisionHandling = {
  result: { append, skip, stop, reject, appendAndStop },
};

export const composeMiddleware = <Input, Context, Output>(
  handler: Handler<Input, Context, Output>,
  middleware: Middleware<Input, Context, Output>[] = [],
): Handler<Input, Context, Output> =>
  middleware.reduceRight((next, current) => current(next), handler);

type Callback<Input, Context> = (
  input: Input,
  context: Context,
) => void | Promise<void>;

export const before =
  <Input, Context, Output>(
    callback: Callback<Input, Context>,
  ): Middleware<Input, Context, Output> =>
  (next) =>
  async (input, context) => {
    await callback(input, context);
    return next(input, context);
  };

export const after =
  <Input, Context, Output>(
    callback: (
      result: DecisionHandlingResult<Output>,
      input: Input,
      context: Context,
    ) =>
      DecisionHandlingResult<Output> | Promise<DecisionHandlingResult<Output>>,
  ): Middleware<Input, Context, Output> =>
  (next) =>
  async (input, context) =>
    callback(await next(input, context), input, context);

export type OutputPredicate<Output, Input = unknown, Context = unknown> = (
  output: Output,
  input: Input,
  context: Context,
) => boolean;

const mapOn =
  <Input, Context, Output>(
    predicate: OutputPredicate<Output, Input, Context>,
    map: (outputs: Output[]) => DecisionHandlingResult<Output>,
  ): Middleware<Input, Context, Output> =>
  (next) =>
  async (input, context) => {
    const result = await next(input, context);
    return result.outputs.some((output) => predicate(output, input, context))
      ? map(result.outputs)
      : result;
  };

export const skipOn = <Output, Input = unknown, Context = unknown>(
  predicate: OutputPredicate<Output, Input, Context>,
): Middleware<Input, Context, Output> => mapOn(predicate, skip);

export const stopOn = <Output, Input = unknown, Context = unknown>(
  predicate: OutputPredicate<Output, Input, Context>,
): Middleware<Input, Context, Output> => mapOn(predicate, stop);

export const rejectOn = <Output, Input = unknown, Context = unknown>(
  predicate: OutputPredicate<Output, Input, Context>,
): Middleware<Input, Context, Output> => mapOn(predicate, reject);

export const stopAfter = <Output, Input = unknown, Context = unknown>(
  predicate: OutputPredicate<Output, Input, Context>,
): Middleware<Input, Context, Output> => mapOn(predicate, appendAndStop);

export const throwOn =
  <Output, Input = unknown, Context = unknown>(
    predicate: OutputPredicate<Output, Input, Context>,
    errorFactory: (output: Output, input: Input, context: Context) => unknown,
  ): Middleware<Input, Context, Output> =>
  (next) =>
  async (input, context) => {
    const result = await next(input, context);
    const output = result.outputs.find((candidate) =>
      predicate(candidate, input, context),
    );
    if (output !== undefined) throw errorFactory(output, input, context);
    return result;
  };
