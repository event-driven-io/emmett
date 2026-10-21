# Workflows & Steps

> ```typescript
> DBOS.workflow(
>     config: WorkflowConfig = {}
> )
> ```

## Workflows

### DBOS.workflow

```typescript
DBOS.workflow(
    config: WorkflowConfig = {}
)
```

```typescript
export interface WorkflowConfig {
  name?: string;
  maxRecoveryAttempts?: number;
  serialization?: "portable" | "native";
  inputSchema?: InputSchema;
}

export interface InputSchema {
  parse(input: unknown): unknown;
}
```

A decorator that marks a function as a DBOS durable workflow.

**Example:**
```typescript
export class Example {
  @DBOS.workflow()
  static async exampleWorkflow() {
    await Example.stepOne();
    await Example.stepTwo();
  }
}

// The workflow function can be called normally
await Example.exampleWorkflow();
```

**Parameters:**
- **config**:
  - **name**: The name to use for the workflow function.  If not specified, the method name is used.
  - **maxRecoveryAttempts**: The maximum number of times the workflow may be attempted. Defaults to 100.
This acts as a [dead letter queue](https://en.wikipedia.org/wiki/Dead_letter_queue) so that a buggy workflow that crashes its application (for example, by running it out of memory) does not do so infinitely.
If a workflow exceeds this limit, its status is set to `MAX_RECOVERY_ATTEMPTS_EXCEEDED` and it is no longer automatically recovered.
  - **serialization**: The default [serialization format](../../explanations/portable-workflows.md) to use for local invocations of this workflow. Set to `"portable"` to test [cross-language interoperability](../../explanations/portable-workflows.md).
  - **inputSchema**: A schema for validating and optionally transforming workflow input arguments. Must have a `.parse()` method, making it compatible with [Zod](https://zod.dev/) schemas, AJV wrappers, or any custom validator. The schema receives the arguments as an array (tuple) and should return the validated/transformed array. Runs before the workflow function on every invocation (direct call, queue dispatch, and recovery). See [Input Validation and Coercion](#input-validation-and-coercion) below for details and examples.

### DBOS.registerWorkflow

```typescript
DBOS.registerWorkflow<This, Args extends unknown[], Return>(
    func: (this: This, ...args: Args) => Promise<Return>,
    config?: FunctionName & WorkflowConfig,
  ): (this: This, ...args: Args) => Promise<Return>
```

```typescript
interface FunctionName {
  name?: string;
  className?: string;
  ctorOrProto?: object;
}
```

Wrap a function in a DBOS workflow.
Returns the wrapped function.

**Example:**

```typescript
async function exampleWorkflowFunction() {
  await stepOne();
  await stepTwo();
}

const workflow = DBOS.registerWorkflow(exampleWorkflowFunction, {"name": "exampleWorkflow"})
// The registered workflow can be called normally
await workflow();
```

**Parameters:**
- **func**: The function to be wrapped in a workflow.
- **config**: Accepts all fields from [`WorkflowConfig`](#dbosworkflow) plus:
  - **name**: The name with which to register the workflow. Defaults to the function name.
  - **ctorOrProto**: If the function is a class method, its class (for a `static` method) or the class's prototype (for an instance method).
DBOS records the workflow's class so that, when the workflow is dequeued or recovered, it can find the class and, for instance methods, the right [`ConfiguredInstance`](#instance-method-workflows).
You must set this when registering an instance method; otherwise, the workflow can't be run from a queue or recovered.
  - **className**: The name of the class the function belongs to. Defaults to the name of the class given in `ctorOrProto`.
For a `static` method, you can set `className` without `ctorOrProto`. If you set both, `className` must be the class's registered name.
  - **maxRecoveryAttempts**: The maximum number of times the workflow may be attempted. Defaults to 100.
This acts as a [dead letter queue](https://en.wikipedia.org/wiki/Dead_letter_queue) so that a buggy workflow that crashes its application (for example, by running it out of memory) does not do so infinitely.
If a workflow exceeds this limit, its status is set to `MAX_RECOVERY_ATTEMPTS_EXCEEDED` and it is no longer automatically recovered.
  - **serialization**: The default [serialization format](../../explanations/portable-workflows.md) for local invocations of this workflow (`"portable"` or `"native"`).
  - **inputSchema**: A schema for validating/transforming input arguments. See [`WorkflowConfig`](#dbosworkflow) above.

## Input Validation and Coercion

TypeScript workflows can specify an `inputSchema` that validates and optionally transforms arguments before the workflow function runs.
The schema must have a `.parse()` method&mdash;making it compatible with [Zod](https://zod.dev/), [AJV](https://ajv.js.org/) wrappers, or any custom validator.

The schema receives the arguments as a tuple (array) and should return the validated/transformed tuple.
It runs on every invocation: direct calls, queue dispatch, and recovery.

```typescript
import { DBOS } from "@dbos-inc/dbos-sdk";
import { z } from "zod";

// Validation only — reject bad inputs with a clear Zod error
const validatedWorkflow = DBOS.registerWorkflow(
  async (name: string, count: number) => {
    return `${name}:${count}`;
  },
  {
    name: "validatedWorkflow",
    serialization: "portable",
    inputSchema: z.tuple([z.string(), z.number()]),
  },
);

// Validation + coercion — convert ISO date strings to Date objects
const dateWorkflow = DBOS.registerWorkflow(
  async (due: Date) => {
    return `due:${due.toISOString()}`;
  },
  {
    name: "dateWorkflow",
    serialization: "portable",
    inputSchema: z.tuple([z.coerce.date()]),
  },
);
```

Or using decorators:

```typescript
export class Orders {
  @DBOS.workflow({
    serialization: "portable",
    inputSchema: z.tuple([z.string(), z.coerce.date()]),
  })
  static async processOrder(orderId: string, due: Date): Promise<string> {
    return `${orderId} due ${due.toISOString()}`;
  }
}
```

For more context on why input validation matters for cross-language workflows, see [Input Validation and Coercion](../../explanations/portable-workflows.md#input-validation-and-coercion).

## Steps

### DBOS.step

```typescript
DBOS.step(
    config: StepConfig = {}
)
```

```typescript
interface StepConfig {
  retriesAllowed?: boolean; // Should failures be retried? (default false)
  intervalSeconds?: number; // Seconds to wait before the first retry attempt (default 1)
  maxAttempts?: number;     // Maximum number of attempts, including the first (default 3)
  backoffRate?: number;     // Multiplier by which the retry interval increases after a retry attempt (default 2)
  shouldRetry?: (error: unknown) => boolean | Promise<boolean>; // Predicate called after a failure to decide whether to retry (default: retry every error)
  timeoutMS?: number;
  name?: string;
}
```

A decorator that marks a function as a step in a durable workflow.
DBOS must be launched before a step is called.
If a step is called outside a workflow, it runs as an ordinary function call, without checkpoints, retries, or a timeout.

**Example:**
```typescript
export class Example {
  @DBOS.step()
  static async stepOne() {
    DBOS.logger.info("Step one completed!");
  }

  @DBOS.step()
  static async stepTwo() {
    DBOS.logger.info("Step two completed!");
  }

  // Call steps from workflows
  @DBOS.workflow()
  static async exampleWorkflow() {
    await Example.stepOne();
    await Example.stepTwo();
  }
}
```

**Parameters:**
- **config**:
  - **retriesAllowed**: Whether to retry the step if it throws an exception.
  - **intervalSeconds**: How long to wait before the initial retry.
  - **maxAttempts**: The maximum number of times to attempt a step that is throwing exceptions, including the first attempt.
  - **backoffRate**: How much to multiplicatively increase `intervalSeconds` between retries.
  - **shouldRetry**: Predicate called with the thrown error to decide whether the step should be retried. If it returns `false` (or a promise resolving to `false`), the error is re-thrown immediately without further retries. Ignored when `retriesAllowed` is `false`.
  - **timeoutMS**: The maximum duration, in milliseconds, of a single attempt of this step. An attempt that exceeds it fails with `DBOSStepTimeoutError`; if `retriesAllowed` is `true`, the timed-out attempt is retried like any other failure. The step is not forcibly terminated; instead, [`DBOS.stepStatus.timeoutSignal`](./methods.md#dbosstepstatus) fires so the step can cooperatively cancel its underlying operation. A step that ignores the signal keeps running in the background and its result is discarded.
  - **name**: Name for the step function.  If not specified, the method name is used.

### DBOS.registerStep

```typescript
DBOS.registerStep<This, Args extends unknown[], Return>(
    func: (this: This, ...args: Args) => Promise<Return>,
    config: StepConfig & FunctionName = {},
): (this: This, ...args: Args) => Promise<Return>
```

Wrap a function in a step to safely call it from a durable workflow.
Returns the wrapped function.
DBOS must be launched before the wrapped function is called.
If it is called outside a workflow, it runs as an ordinary function call, without checkpoints, retries, or a timeout.

**Example:**

```typescript
async function stepOneFunction() {
  DBOS.logger.info("Step one completed!");
}
const stepOne = DBOS.registerStep(stepOneFunction, {"name": "stepOne"});

async function stepTwoFunction() {
  DBOS.logger.info("Step two completed!");
}
const stepTwo = DBOS.registerStep(stepTwoFunction, {"name": "stepTwo"});

// Call steps from workflows
async function workflowFunction() {
  await stepOne();
  await stepTwo();
}
const workflow = DBOS.registerWorkflow(workflowFunction, {"name": "exampleWorkflow"})
```

**Parameters:**
- **func**: The function to be wrapped in a step.
- **config**:
  - **name**: A name to give the step. If not provided, use the function name.
  - **retriesAllowed**: Whether to retry the step if it throws an exception.
  - **intervalSeconds**: How long to wait before the initial retry.
  - **maxAttempts**: The maximum number of times to attempt a step that is throwing exceptions, including the first attempt.
  - **backoffRate**: How much to multiplicatively increase `intervalSeconds` between retries.
  - **shouldRetry**: Predicate called with the thrown error to decide whether the step should be retried. If it returns `false` (or a promise resolving to `false`), the error is re-thrown immediately without further retries. Ignored when `retriesAllowed` is `false`.
  - **timeoutMS**: The maximum duration, in milliseconds, of a single attempt of this step. An attempt that exceeds it fails with `DBOSStepTimeoutError`; if `retriesAllowed` is `true`, the timed-out attempt is retried like any other failure. The step is not forcibly terminated; instead, [`DBOS.stepStatus.timeoutSignal`](./methods.md#dbosstepstatus) fires so the step can cooperatively cancel its underlying operation. A step that ignores the signal keeps running in the background and its result is discarded.

### DBOS.runStep

```typescript
runStep<Return>(
  func: () => Promise<Return>,
  config: StepConfig & { name?: string } = {}
): Promise<Return>
```

Run a function as a step in a workflow.
DBOS must be launched before `runStep` is called.
If called outside a workflow, `runStep` runs the function as an ordinary function call, without checkpoints, retries, or a timeout.
Returns the output of the step.

**Example:**

```typescript
async function stepOne() {
  DBOS.logger.info("Step one completed!");
}

async function stepTwo() {
  DBOS.logger.info("Step two completed!");
}

// Use DBOS.runStep to run any function as a step
async function exampleWorkflow() {
  await DBOS.runStep(() => stepOne(), {name: "stepOne"});
  await DBOS.runStep(() => stepTwo(), {name: "stepTwo"});
}
```

**Parameters:**
- **func**: The function to run as a step.
- **config**:
  - **name**: A name to give the step.
  - **retriesAllowed**: Whether to retry the step if it throws an exception.
  - **intervalSeconds**: How long to wait before the initial retry.
  - **maxAttempts**: The maximum number of times to attempt a step that is throwing exceptions, including the first attempt.
  - **backoffRate**: How much to multiplicatively increase `intervalSeconds` between retries.
  - **shouldRetry**: Predicate called with the thrown error to decide whether the step should be retried. If it returns `false` (or a promise resolving to `false`), the error is re-thrown immediately without further retries. Ignored when `retriesAllowed` is `false`.
  - **timeoutMS**: The maximum duration, in milliseconds, of a single attempt of this step. An attempt that exceeds it fails with `DBOSStepTimeoutError`; if `retriesAllowed` is `true`, the timed-out attempt is retried like any other failure. The step is not forcibly terminated; instead, [`DBOS.stepStatus.timeoutSignal`](./methods.md#dbosstepstatus) fires so the step can cooperatively cancel its underlying operation. A step that ignores the signal keeps running in the background and its result is discarded.

## Class Names

Workflows are uniquely identified by a class name + function name pair.

If a function is registered through a decorator, by default the class name is taken from the `class` itself, but the name may be overridden with the `DBOS.className` decorator.

This allows:
  - reusing the same `class` identifier across multiple files, or
  - renaming/refactoring class names in code without breaking existing workflow registrations.

### DBOS.className

```typescript
DBOS.className(
    className: string
)
```

**Example:**
```typescript
@DBOS.className('RegisteredClassName')
export class Example {
  @DBOS.workflow({name: 'RegisteredWorkflowName'})
  static async exampleWorkflow() {
    // This workflow will be registered as 'RegisteredClassName/RegisteredWorkflowName'
    //    for recovery and observability purposes
  }
}
```

## Instance Method Workflows

```typescript
abstract class ConfiguredInstance {
  constructor(name: string)  
}
```

You can register or decorate class instance methods.  However, if a class has any instance methods that are workflows or are decorated with `@DBOS.step`, that class must inherit from `ConfiguredInstance`, which takes an instance name and registers the instance.

When you create a new instance of the class, the constructor for the base `ConfiguredInstance` must be called with a `name`.
This `name` should be unique among instances of the same class.
Additionally, all `ConfiguredInstance` classes must be instantiated before `DBOS.launch()` is called.

For example:
```typescript
class MyClass extends ConfiguredInstance {
  cfg: MyConfig;
  constructor(name: string, config: MyConfig) {
    super(name);
    this.cfg = config;
  }

  @DBOS.workflow()
  async testWorkflow(p: string): Promise<void> {
    // ... Operations that use this.cfg
  }
}

const myClassInstance = new MyClass('instanceA', myConfig);
```

To register an instance method without decorators, register it on the class prototype with [`DBOS.registerWorkflow`](#dbosregisterworkflow), passing that prototype as `ctorOrProto` so DBOS can find the instance when the workflow is dequeued or recovered:

```typescript
class MyClass extends ConfiguredInstance {
  cfg: MyConfig;
  constructor(name: string, config: MyConfig) {
    super(name);
    this.cfg = config;
  }

  async testWorkflow(p: string): Promise<void> {
    // ... Operations that use this.cfg
  }
}

MyClass.prototype.testWorkflow = DBOS.registerWorkflow(MyClass.prototype.testWorkflow, {
  name: "testWorkflow",
  ctorOrProto: MyClass.prototype,
});

const myClassInstance = new MyClass('instanceA', myConfig);
```

The reason for these requirements is to enable workflow recovery.  When you create a new instance of a `ConfiguredInstance` class, DBOS stores it in a global registry indexed by `name`.  When DBOS needs to recover a workflow belonging to that class, it looks up the `name` so it can run the workflow using the right class instance.  While names are used by DBOS Transact internally to find the correct object instance across system restarts, they are also potentially useful for monitoring, tracing, and debugging.

## Patching

### patch

```typescript
DBOS.patch(
    patchName: string
): Promise<boolean>
```

Insert a patch marker at the current point in workflow history, returning `true` if it was successfully inserted (or this patch marker is already present) and `false` if a different checkpoint is already present at this point in history, indicating that the workflow should run unpatched.
Used to safely upgrade workflow code, see the [patching tutorial](../tutorials/upgrading-workflows.md#patching) for more detail.
Must be called from a workflow, and requires [`enablePatching`](./configuration.md#application-settings) to be set in your configuration.

**Parameters:**
- `patchName`: The name to give the patch marker that will be inserted into workflow history.

### deprecatePatch

```typescript
DBOS.deprecatePatch(
    patchName: string
): Promise<boolean>
```

Safely bypass a patch marker at the current point in workflow history if present.
Always returns `true`.
Used to safely deprecate patches, see the [patching tutorial](../tutorials/upgrading-workflows.md#patching) for more detail. 
Must be called from a workflow, and requires [`enablePatching`](./configuration.md#application-settings) to be set in your configuration.

**Parameters:**
- `patchName`: The name of the patch marker to be bypassed.
