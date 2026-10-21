/**
 * `Runnables` in the Hatchet TypeScript SDK are things that can be run, namely tasks and workflows. The two main types of runnables you'll encounter are:
 *
 * - `WorkflowDeclaration`, returned by `hatchet.workflow(...)`, which lets you define tasks and call `run()`, `schedule()`, `cron()`, etc.
 * - `TaskWorkflowDeclaration`, returned by `hatchet.task(...)`, which is a single standalone task that exposes the same execution helpers as a workflow.
 * @module Runnables
 */
import WorkflowRunRef from '../util/workflow-run-ref';
import { CronWorkflows, ScheduledWorkflows, V1CreateFilterRequest } from '../clients/rest/generated/data-contracts';
import * as z from 'zod/v4';
import { IHatchetClient } from './client/client.interface';
import { CreateWorkflowTaskOpts, CreateOnFailureTaskOpts, TaskFn, CreateWorkflowDurableTaskOpts, CreateBaseTaskOpts, CreateOnSuccessTaskOpts, Concurrency, DurableTaskFn, WorkerLabelComparator, IdempotencyConfig, BatchTaskConfig, BatchTaskFn } from './task';
import { Duration } from './client/duration';
import { MetricsClient } from './client/features/metrics';
import { InputType, OutputType, UnknownInputType, JsonObject, Resolved } from './types';
import { Context, DurableContext } from './client/worker/context';
import { EvictionPolicy } from './client/worker/eviction/eviction-policy';
import type { FunctionTool } from '@openai/agents';
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { OpenAIToolFuncT } from './agent/openai';
import type { ClaudeToolFuncT } from './agent/claude';
export declare enum Priority {
    LOW = 1,
    MEDIUM = 2,
    HIGH = 3
}
type AgentSdkFuncMap = {
    claude: ClaudeToolFuncT;
    openai: OpenAIToolFuncT;
};
type Tail<T extends any[]> = T extends [any, ...infer R] ? R : never;
/**
 * Additional metadata that can be attached to a workflow run.
 */
type AdditionalMetadata = Record<string, string>;
/**
 * Options for running a workflow.
 * @hidden
 */
export type RunOpts = {
    /**
     * (optional) additional metadata to attach to the workflow run.
     */
    additionalMetadata?: AdditionalMetadata;
    /**
     * (optional) the priority for the workflow run.
     *
     * values: Priority.LOW, Priority.MEDIUM, Priority.HIGH (1, 2, or 3 )
     */
    priority?: Priority;
    /**
     * (optional) if the task run should be run on the same worker.
     * only used if spawned from within a parent task.
     */
    sticky?: boolean;
    /**
     * (optional) the child key for the workflow run.
     * only used if spawned from within a parent task.
     */
    childKey?: string;
    /**
     * (optional) when running multiple workflows (array input), if true, return
     * exceptions in the result array instead of throwing. Successes are outputs,
     * failures are Error instances.
     */
    returnExceptions?: boolean;
    /**
     * (optional) desired worker labels for routing the workflow run to specific workers.
     */
    desiredWorkerLabels?: Record<string, {
        value: string | number;
        required?: boolean;
        weight?: number;
        comparator?: WorkerLabelComparator;
    }>;
};
export type RunManyOpt<I extends InputType = UnknownInputType> = {
    input: I;
    opts?: RunOpts;
};
/**
 * Helper type to safely extract output types from task results
 * @hidden
 */
export type TaskOutput<O, Key extends string, Fallback> = O extends Record<Key, infer Value> ? (Value extends OutputType ? Value : Fallback) : Fallback;
/**
 * Extracts a property from an object type based on task name, or falls back to inferred type
 * @hidden
 */
export type TaskOutputType<O, TaskName extends string, InferredType extends OutputType> = TaskName extends keyof O ? O[TaskName] extends OutputType ? O[TaskName] : InferredType : InferredType;
type DefaultFilter = Omit<V1CreateFilterRequest, 'workflowId'>;
/**
 * Sticky strategy for workflow scheduling.
 *
 * Prefer using `StickyStrategy.SOFT` / `StickyStrategy.HARD` (v1, non-protobuf).
 * For backwards compatibility, the workflow/task `sticky` field also accepts legacy
 * protobuf enum values (`0`/`1`) and strings (`'SOFT'`/`'HARD'`).
 * @internal
 */
export declare const StickyStrategy: {
    readonly SOFT: "soft";
    readonly HARD: "hard";
};
export type StickyStrategy = (typeof StickyStrategy)[keyof typeof StickyStrategy];
export type StickyStrategyInput = StickyStrategy | 'SOFT' | 'HARD' | 0 | 1;
export type CreateBaseWorkflowOpts = {
    /**
     * The name of the workflow.
     */
    name: string;
    /**
     * (optional) description of the workflow.
     */
    description?: string;
    /**
     * (optional) version of the workflow.
     */
    version?: string;
    /**
     * (optional) sticky strategy for the workflow.
     */
    sticky?: StickyStrategyInput;
    /**
     * (optional) on config for the workflow.
     * @alias for onCrons and onEvents
     */
    on?: {
        cron?: string | string[];
        event?: string | string[];
    };
    /**
     * (optional) cron config for the workflow.
     */
    onCrons?: string[];
    /**
     * (optional) event config for the workflow.
     */
    onEvents?: string[];
    /**
     * (optional) concurrency config for the workflow.
     */
    concurrency?: Concurrency | Concurrency[];
    /**
     * (optional) the priority for the workflow.
     * values: Priority.LOW, Priority.MEDIUM, Priority.HIGH (1, 2, or 3 )
     */
    defaultPriority?: Priority;
    defaultFilters?: DefaultFilter[];
    /**
     * (optional) Zod schema for the workflow input.
     * When provided, a JSON Schema is generated and sent to the Hatchet backend, which
     * can be used on the dashboard for autocomplete.
     */
    inputValidator?: z.ZodType<any>;
    /**
     * (optional) idempotency configuration for the workflow.
     * Prevents more than one run from occurring for a given key within the TTL window.
     */
    idempotency?: IdempotencyConfig;
};
export type CreateTaskWorkflowOpts<I extends InputType = UnknownInputType, O extends OutputType = void> = CreateBaseWorkflowOpts & CreateBaseTaskOpts<I, O, TaskFn<I, O>>;
/**
 * Options for creating a batch task workflow. Batch tasks buffer concurrent runs and
 * dispatch them together as a single execution; fn receives a Record keyed by each
 * buffered run's task-run external id.
 *
 * Preview: batch tasks are in beta and may change in future releases.
 */
export type CreateBatchTaskWorkflowOpts<I extends InputType = UnknownInputType, O extends OutputType = void> = CreateBaseWorkflowOpts & CreateBaseTaskOpts<I, O, BatchTaskFn<I, O>> & {
    batch: BatchTaskConfig;
};
export type CreateDurableTaskWorkflowOpts<I extends InputType = UnknownInputType, O extends OutputType = void> = CreateBaseWorkflowOpts & CreateBaseTaskOpts<I, O, DurableTaskFn<I, O>> & {
    evictionPolicy?: EvictionPolicy;
};
/**
 * Options for creating a new workflow.
 * @hidden
 */
export type CreateWorkflowOpts = CreateBaseWorkflowOpts & {
    /**
     * (optional) default configuration for all tasks in the workflow.
     */
    taskDefaults?: TaskDefaults;
};
/**
 * Default configuration for all tasks in the workflow.
 * Can be overridden by task-specific options.
 * @hidden
 */
export type TaskDefaults = {
    /**
     * (optional) execution timeout duration for the task after it starts running
     * go duration format (e.g., "1s", "5m", "1h").
     *
     * default: 60s
     */
    executionTimeout?: Duration;
    /**
     * (optional) schedule timeout for the task (max duration to allow the task to wait in the queue)
     * go duration format (e.g., "1s", "5m", "1h").
     *
     * default: 5m
     */
    scheduleTimeout?: Duration;
    /**
     * (optional) number of retries for the task.
     *
     * default: 0
     */
    retries?: CreateWorkflowTaskOpts<any, any>['retries'];
    /**
     * (optional) backoff strategy configuration for retries.
     * - factor: Base of the exponential backoff (base ^ retry count)
     * - maxSeconds: Maximum backoff duration in seconds
     */
    backoff?: CreateWorkflowTaskOpts<any, any>['backoff'];
    /**
     * (optional) rate limits for the task.
     */
    rateLimits?: CreateWorkflowTaskOpts<any, any>['rateLimits'];
    /**
     * (optional) worker labels for task routing and scheduling.
     * Each label can be a simple string/number value or an object with additional configuration:
     * - value: The label value (string or number)
     * - required: Whether the label is required for worker matching
     * - weight: Priority weight for worker selection
     * - comparator: Custom comparison logic for label matching
     */
    workerLabels?: CreateWorkflowTaskOpts<any, any>['desiredWorkerLabels'];
    /**
     * (optional) the concurrency options for the task, processed in array order. Entries
     * may be workflow-scoped strategies or tenant-scoped entries (`isTenantScoped`)
     * strategies, whose definitions are upserted as part of workflow registration.
     */
    concurrency?: Concurrency | Concurrency[];
};
/**
 * Internal definition of a workflow and its tasks.
 * @hidden
 */
export type WorkflowDefinition = CreateWorkflowOpts & {
    /**
     * The tasks that make up this workflow.
     */
    _tasks: CreateWorkflowTaskOpts<any, any>[];
    /**
     * The durable tasks that make up this workflow.
     */
    _durableTasks: CreateWorkflowDurableTaskOpts<any, any>[];
    /**
     * (optional) onFailure handler for the workflow.
     * Invoked when any task in the workflow fails.
     * @param ctx The context of the workflow.
     */
    onFailure?: TaskFn<any, any> | CreateOnFailureTaskOpts<any, any>;
    /**
     * (optional) onSuccess handler for the workflow.
     * Invoked when all tasks in the workflow complete successfully.
     * @param ctx The context of the workflow.
     */
    onSuccess?: TaskFn<any, any> | CreateOnSuccessTaskOpts<any, any>;
};
/**
 * Represents a workflow that can be executed by Hatchet.
 * @template I The input type for the workflow.
 * @template O The return type of the workflow.
 * @internal
 */
export declare class BaseWorkflowDeclaration<I extends InputType = UnknownInputType, O extends OutputType = void> {
    /**
     * The Hatchet client instance used to execute the workflow.
     * @internal
     */
    client: IHatchetClient | undefined;
    /**
     * The internal workflow definition.
     * @internal
     */
    definition: WorkflowDefinition;
    /**
     * Creates a new workflow instance.
     * @param options The options for creating the workflow.
     * @param client Optional Hatchet client instance.
     * @internal
     */
    constructor(options: CreateWorkflowOpts, client?: IHatchetClient);
    /**
     * Synchronously trigger a workflow run without waiting for it to complete. This method is useful for starting a workflow run and immediately returning a reference to the run without blocking while the workflow runs.
     * @param input The input data for the workflow.
     * @param options Optional configuration for this workflow run.
     * @returns A WorkflowRunRef containing the run ID and methods to get results and interact with the run.
     * @throws Error if the workflow is not bound to a Hatchet client.
     */
    runNoWait(input: I, options?: RunOpts, _standaloneTaskName?: string): Promise<WorkflowRunRef<O>>;
    runNoWait(input: I[], options?: RunOpts, _standaloneTaskName?: string): Promise<WorkflowRunRef<O>[]>;
    /**
     * Synchronously trigger multiple workflow runs without waiting for completion.
     * @param runs A list of run requests containing input and per-run options.
     * @returns WorkflowRunRef values in the same order as input runs.
     * @throws Error if the workflow is not bound to a Hatchet client.
     */
    runManyNoWait(runs: RunManyOpt<I>[], _standaloneTaskName?: string): Promise<WorkflowRunRef<O>[]>;
    /**
     * @alias run
     * Triggers a workflow run and waits for the result.
     * @template I - The input type for the workflow
     * @template O - The return type of the workflow
     * @param input - The input data for the workflow
     * @param options - Configuration options for the workflow run
     * @returns A promise that resolves with the workflow result
     */
    runAndWait(input: I, options?: RunOpts, _standaloneTaskName?: string): Promise<O>;
    runAndWait(input: I[], options?: RunOpts, _standaloneTaskName?: string): Promise<O[]>;
    /**
     * Executes the workflow with the given input and awaits the results.
     * @param input The input data for the workflow.
     * @param options Optional configuration for this workflow run.
     * @returns A promise that resolves with the workflow result.
     * @throws Error if the workflow is not bound to a Hatchet client.
     */
    run(input: I, options?: RunOpts, _standaloneTaskName?: string): Promise<O>;
    run(input: I[], options?: RunOpts, _standaloneTaskName?: string): Promise<O[]>;
    /**
     * Executes many workflow runs and waits for all results.
     * @param runs A list of run requests containing input and per-run options.
     * @returns Results in the same order as input runs.
     */
    runMany(runs: RunManyOpt<I>[], _standaloneTaskName?: string): Promise<O[]>;
    /**
     * Schedules a workflow to run at a specific date and time in the future.
     * @param enqueueAt The date when the workflow should be triggered.
     * @param input The input data for the workflow.
     * @param options Optional configuration for this workflow run.
     * @returns A promise that resolves with the scheduled workflow details.
     * @throws Error if the workflow is not bound to a Hatchet client.
     */
    schedule(enqueueAt: Date, input: I, options?: RunOpts): Promise<ScheduledWorkflows>;
    /**
     * Schedules a workflow to run after a specified delay.
     * @param duration The delay in seconds before the workflow should run.
     * @param input The input data for the workflow.
     * @param options Optional configuration for this workflow run.
     * @returns A promise that resolves with the scheduled workflow details.
     * @throws Error if the workflow is not bound to a Hatchet client.
     */
    delay(duration: number, input: I, options?: RunOpts): Promise<ScheduledWorkflows>;
    /**
     * Creates a cron schedule for the workflow.
     * @param name The name of the cron schedule.
     * @param expression The cron expression defining the schedule.
     * @param input The input data for the workflow.
     * @param options Optional configuration for this workflow run.
     * @returns A promise that resolves with the cron workflow details.
     * @throws Error if the workflow is not bound to a Hatchet client.
     */
    cron(name: string, expression: string, input: I, options?: RunOpts): Promise<CronWorkflows>;
    /**
     * Get metrics for the workflow.
     * @param opts Optional configuration for the metrics request.
     * @returns A promise that resolves with the workflow metrics.
     * @throws Error if the workflow is not bound to a Hatchet client.
     */
    metrics(opts?: Omit<Parameters<MetricsClient['getTaskStatusMetrics']>[0], 'workflows'>): Promise<import("./client/features/metrics").TaskStatusMetrics>;
    /**
     * Get queue metrics for the workflow.
     * @param opts Optional configuration for the metrics request.
     * @returns A promise that resolves with the workflow metrics.
     * @throws Error if the workflow is not bound to a Hatchet client.
     */
    taskStatusMetrics(opts?: Omit<Parameters<MetricsClient['getTaskStatusMetrics']>[0], 'workflows'>): Promise<import("./client/features/metrics").TaskStatusMetrics>;
    /**
     * Get the current state of the workflow.
     * @returns A promise that resolves with the workflow state.
     * @throws Error if the workflow is not bound to a Hatchet client.
     */
    get(): Promise<import("../clients/rest/generated/data-contracts").Workflow>;
    /**
     * @deprecated use definition.name instead
     * @hidden
     */
    get id(): string;
    /**
     * Get the friendly name of the workflow.
     * @returns The name of the workflow.
     */
    get name(): string;
    /**
     * Create an MCP tool from a workflow. Supports both Claude and OpenAI agent sdks.
     * @param sdk The agent SDK the tool will be used with.
     * @param args Optional arguments passed to create the MCP tool object.
     * @returns The MCP tool object.
     **/
    mcpTool(sdk: 'claude', ...args: Tail<Parameters<AgentSdkFuncMap['claude']>>): SdkMcpToolDefinition;
    mcpTool(sdk: 'openai', ...args: Tail<Parameters<AgentSdkFuncMap['openai']>>): FunctionTool;
}
/**
 * A Hatchet workflow, which lets you define tasks and perform actions on the workflow.
 *
 * Workflows in Hatchet represent coordinated units of work that can be triggered,
 * scheduled, or run on a cron schedule. Each workflow can contain multiple tasks
 * that can be arranged in dependencies (DAGs), with customized retry behavior,
 * timeouts, concurrency controls, and more.
 *
 * Example:
 * ```typescript
 * import { hatchet } from './hatchet-client';
 *
 * type MyInput = { name: string };
 *
 * const workflow = hatchet.workflow<MyInput>({
 *   name: 'my-workflow',
 * });
 *
 * workflow.task({
 *   name: 'greet',
 *   fn: async (input) => {
 *     return { message: `Hello, ${input.name}!` };
 *   },
 * });
 *
 * // Run the workflow
 * await workflow.run({ name: 'World' });
 * ```
 *
 * Workflows support various execution patterns, including:
 * - One-time execution with `run()` and `runNoWait()`
 * - Scheduled execution with `schedule()`
 * - Cron-based recurring execution with `cron()`
 * - Bulk execution by passing an array input to `run()` and `runNoWait()`
 * - Per-run bulk execution options with `runMany()` and `runManyNoWait()`
 *
 * Tasks within workflows can be defined with `workflow.task()` or
 * `workflow.durableTask()` and arranged into complex dependency patterns.
 */
export declare class WorkflowDeclaration<I extends InputType = UnknownInputType, O extends OutputType = void, MiddlewareBefore extends Record<string, any> = {}> extends BaseWorkflowDeclaration<I, O> {
    /**
     * Adds a task to the workflow.
     * The return type will be either the property on O that corresponds to the task name,
     * or if there is no matching property, the inferred return type of the function.
     * @template Name The literal string name of the task.
     * @template Fn The type of the task function.
     * @param options The task configuration options.
     * @returns The task options that were added.
     */
    task<Name extends string, Fn extends (Name extends keyof O ? (input: I & MiddlewareBefore, ctx: Context<I & MiddlewareBefore>) => O[Name] extends OutputType ? O[Name] | Promise<O[Name]> : void : (input: I & MiddlewareBefore, ctx: Context<I & MiddlewareBefore>) => void), FnReturn = ReturnType<Fn> extends Promise<infer P> ? P : ReturnType<Fn>, TO extends OutputType = Name extends keyof O ? O[Name] extends OutputType ? O[Name] : never : FnReturn extends OutputType ? FnReturn : never>(options: (Omit<CreateWorkflowTaskOpts<I, TO>, 'fn'> & {
        name: Name;
        fn?: Fn;
    }) | TaskWorkflowDeclaration<I, TO>): CreateWorkflowTaskOpts<I, TO>;
    /**
     * Adds a batch task to the workflow. Batch tasks buffer concurrent runs until Hatchet
     * flushes the batch (size reached or flush interval), then invoke the handler once with
     * all buffered inputs keyed by each run's task-run external id. The handler must return
     * a Record mapping each id to its output, or set `batch.broadcastOutput` to return the
     * same result to all callers. retries is always forced to 0 for batch tasks.
     *
     * Preview: batch tasks are in beta and may change in future releases.
     * @template Fn The type of the batch task function.
     * @param options The batch task configuration options.
     * @returns The task options that were added.
     */
    batchTask<Fn extends BatchTaskFn<TI, TO>, TI extends InputType = Parameters<Fn>[0] extends Record<string, infer II> ? II extends InputType ? II : UnknownInputType : UnknownInputType, TO extends OutputType = ReturnType<Fn> extends Promise<infer P> ? P extends OutputType ? P : void : ReturnType<Fn> extends OutputType ? ReturnType<Fn> : void>(options: {
        fn: Fn;
        batch: BatchTaskConfig;
    } & Omit<CreateBatchTaskWorkflowOpts<TI, TO>, 'fn' | 'batch' | 'name'> & {
        name: string;
    }): CreateWorkflowTaskOpts<TI, TO>;
    /**
     * Adds an onFailure task to the workflow.
     * This will only run if any task in the workflow fails.
     * @template Name The literal string name of the task.
     * @template L The inferred return type of the task function.
     * @param options The task configuration options.
     * @returns The task options that were added.
     */
    onFailure<Name extends string, L extends OutputType>(options: (Omit<CreateOnFailureTaskOpts<I, TaskOutputType<O, Name, L>>, 'fn'> & {
        fn: (input: I, ctx: Context<I>) => TaskOutputType<O, Name, L> | Promise<TaskOutputType<O, Name, L>>;
    }) | TaskWorkflowDeclaration<any, any>): CreateWorkflowTaskOpts<I, TaskOutputType<O, Name, L>>;
    /**
     * Adds an onSuccess task to the workflow.
     * This will only run if all tasks in the workflow complete successfully.
     * @template Name The literal string name of the task.
     * @template L The inferred return type of the task function.
     * @param options The task configuration options.
     * @returns The task options that were added.
     */
    onSuccess<Name extends string, L extends OutputType>(options: (Omit<CreateOnSuccessTaskOpts<I, TaskOutputType<O, Name, L>>, 'fn'> & {
        fn: (input: I, ctx: Context<I>) => TaskOutputType<O, Name, L> | Promise<TaskOutputType<O, Name, L>>;
    }) | TaskWorkflowDeclaration<any, any>): CreateWorkflowTaskOpts<I, TaskOutputType<O, Name, L>>;
    /**
     * Adds a durable task to the workflow.
     * The return type will be either the property on O that corresponds to the task name,
     * or if there is no matching property, the inferred return type of the function.
     * @template Name The literal string name of the task.
     * @template Fn The type of the task function.
     * @param options The task configuration options.
     * @returns The task options that were added.
     */
    durableTask<Name extends string, Fn extends (Name extends keyof O ? (input: I & MiddlewareBefore, ctx: DurableContext<I & MiddlewareBefore>) => O[Name] extends OutputType ? O[Name] | Promise<O[Name]> : void : (input: I & MiddlewareBefore, ctx: DurableContext<I & MiddlewareBefore>) => void), FnReturn = ReturnType<Fn> extends Promise<infer P> ? P : ReturnType<Fn>, TO extends OutputType = Name extends keyof O ? O[Name] extends OutputType ? O[Name] : never : FnReturn extends OutputType ? FnReturn : never>(options: Omit<CreateWorkflowTaskOpts<I, TO>, 'fn' | 'slotCost' | 'batch'> & {
        name: Name;
        fn: Fn;
    }): CreateWorkflowDurableTaskOpts<I, TO>;
}
/**
 * A standalone task declaration that can be run like a workflow.
 *
 * `TaskWorkflowDeclaration` is returned by `hatchet.task(...)` and wraps a single
 * task definition while exposing the same execution helpers as workflows, such as
 * `run()`, `runNoWait()`, `schedule()`, and `cron()` (inherited from
 * `BaseWorkflowDeclaration`).
 *
 * Example:
 * ```typescript
 * const greet = hatchet.task<{ name: string }, { message: string }>({
 *   name: 'greet',
 *   fn: async (input) => ({ message: `Hello, ${input.name}!` }),
 * });
 *
 * await greet.run({ name: 'World' });
 * const ref = await greet.runNoWait({ name: 'World' });
 * ```
 *
 * @template I The input type for the standalone task.
 * @template O The output type returned by the standalone task.
 * @template GlobalInput - Global input type from the client, merged into all run/schedule/cron input signatures.
 * @template MiddlewareBefore - Extra fields added to the task fn input by pre-middleware hooks.
 * @template MiddlewareAfter - Extra fields merged into the task output by post-middleware hooks.
 */
export declare class TaskWorkflowDeclaration<I extends InputType = UnknownInputType, O extends OutputType = void, GlobalInput extends Record<string, any> = {}, GlobalOutput extends Record<string, any> = {}, _MiddlewareBefore extends Record<string, any> = {}, MiddlewareAfter extends Record<string, any> = {}> extends BaseWorkflowDeclaration<I, O> {
    _standalone_task_name: string;
    constructor(options: CreateTaskWorkflowOpts<any, any>, client?: IHatchetClient);
    /**
     * Triggers a task run and waits for the result.
     * @param input - The input data for the task, including global input fields.
     * @param options - Optional configuration for this task run.
     * @returns A promise that resolves with the task output merged with post-middleware fields.
     */
    runAndWait(input: I & GlobalInput, options?: RunOpts): Promise<O & Resolved<GlobalOutput, MiddlewareAfter>>;
    /** @hidden */
    runAndWait(input: (I & GlobalInput)[], options?: RunOpts): Promise<(O & Resolved<GlobalOutput, MiddlewareAfter>)[]>;
    /**
     * Triggers a task run and waits for the result.
     * @param input - The input data for the task, including global input fields.
     * @param options - Optional configuration for this task run.
     * @returns A promise that resolves with the task output merged with post-middleware fields.
     */
    run(input: I & GlobalInput, options?: RunOpts): Promise<O & Resolved<GlobalOutput, MiddlewareAfter>>;
    /** @hidden */
    run(input: (I & GlobalInput)[], options?: RunOpts): Promise<(O & Resolved<GlobalOutput, MiddlewareAfter>)[]>;
    /**
     * Triggers a task run without waiting for completion.
     * @param input - The input data for the task, including global input fields.
     * @param options - Optional configuration for this task run.
     * @returns A WorkflowRunRef containing the run ID and methods to get results.
     */
    runNoWait(input: I & GlobalInput, options?: RunOpts): Promise<WorkflowRunRef<O & Resolved<GlobalOutput, MiddlewareAfter>>>;
    runNoWait(input: (I & GlobalInput)[], options?: RunOpts): Promise<WorkflowRunRef<O & Resolved<GlobalOutput, MiddlewareAfter>>[]>;
    /**
     * Triggers many task runs and waits for all results.
     * @param runs - The list of inputs and optional per-run options.
     * @returns A promise that resolves with ordered task outputs.
     */
    runMany(runs: RunManyOpt<I & GlobalInput>[]): Promise<(O & Resolved<GlobalOutput, MiddlewareAfter>)[]>;
    /**
     * Triggers many task runs without waiting for completion.
     * @param runs - The list of inputs and optional per-run options.
     * @returns WorkflowRunRef values for each scheduled run.
     */
    runManyNoWait(runs: RunManyOpt<I & GlobalInput>[]): Promise<WorkflowRunRef<O & Resolved<GlobalOutput, MiddlewareAfter>>[]>;
    /**
     * Schedules the task to run at a specific date and time.
     * @param enqueueAt - The date when the task should be triggered.
     * @param input - The input data for the task, including global input fields.
     * @param options - Optional configuration for this task run.
     * @returns A promise that resolves with the scheduled workflow details.
     */
    schedule(enqueueAt: Date, input: I & GlobalInput, options?: RunOpts): Promise<ScheduledWorkflows>;
    /**
     * Schedules the task to run after a specified delay.
     * @param duration - The delay in seconds before the task should run.
     * @param input - The input data for the task, including global input fields.
     * @param options - Optional configuration for this task run.
     * @returns A promise that resolves with the scheduled workflow details.
     */
    delay(duration: number, input: I & GlobalInput, options?: RunOpts): Promise<ScheduledWorkflows>;
    /**
     * Creates a cron schedule for the task.
     * @param name - The name of the cron schedule.
     * @param expression - The cron expression defining the schedule.
     * @param input - The input data for the task, including global input fields.
     * @param options - Optional configuration for this task run.
     * @returns A promise that resolves with the cron workflow details.
     */
    cron(name: string, expression: string, input: I & GlobalInput, options?: RunOpts): Promise<CronWorkflows>;
    get taskDef(): CreateWorkflowTaskOpts<any, any>;
}
/**
 * Creates a new task workflow declaration with types inferred from the function parameter.
 * @template Fn The type of the task function
 * @param options The task configuration options.
 * @param client Optional Hatchet client instance.
 * @returns A new TaskWorkflowDeclaration with inferred types.
 */
export declare function CreateTaskWorkflow<Fn extends (input: I, ctx?: any) => O | Promise<O>, I extends InputType = Parameters<Fn>[0], O extends OutputType = ReturnType<Fn> extends Promise<infer P> ? P extends OutputType ? P : void : ReturnType<Fn> extends OutputType ? ReturnType<Fn> : void>(options: {
    fn: Fn;
} & Omit<CreateTaskWorkflowOpts<I, O>, 'fn'>, client?: IHatchetClient): TaskWorkflowDeclaration<I, O>;
/**
 * Creates a new batch task workflow declaration, with the handler's single return value
 * broadcast to every member of the batch.
 * @template Fn The type of the batch task function
 * @param options The batch task configuration options.
 * @param client Optional Hatchet client instance.
 * @returns A new TaskWorkflowDeclaration with inferred types.
 *
 * Preview: batch tasks are in beta and may change in future releases.
 */
export declare function CreateBatchTaskWorkflow<Fn extends (input: Record<string, I>, ctx: Context<Record<string, I>>) => O | Promise<O>, I extends InputType = Parameters<Fn>[0] extends Record<string, infer II> ? II extends InputType ? II : UnknownInputType : UnknownInputType, O extends OutputType = ReturnType<Fn> extends Promise<infer P> ? P extends OutputType ? P : void : ReturnType<Fn> extends OutputType ? ReturnType<Fn> : void>(options: {
    fn: Fn;
    batch: BatchTaskConfig & {
        broadcastOutput: true;
    };
} & Omit<CreateBatchTaskWorkflowOpts<I, O>, 'fn' | 'batch'>, client?: IHatchetClient): TaskWorkflowDeclaration<I, O>;
/**
 * Creates a new batch task workflow declaration. The handler receives a Record keyed by
 * batch member id and must return a Record with the exact same key set.
 * @template Fn The type of the batch task function
 * @param options The batch task configuration options.
 * @param client Optional Hatchet client instance.
 * @returns A new TaskWorkflowDeclaration with inferred types.
 *
 * Preview: batch tasks are in beta and may change in future releases.
 */
export declare function CreateBatchTaskWorkflow<Fn extends (input: Record<string, I>, ctx: Context<Record<string, I>>) => Record<string, O> | Promise<Record<string, O>>, I extends InputType = Parameters<Fn>[0] extends Record<string, infer II> ? II extends InputType ? II : UnknownInputType : UnknownInputType, O extends OutputType = ReturnType<Fn> extends Promise<infer P> ? P extends Record<string, infer OO> ? OO extends OutputType ? OO : void : void : ReturnType<Fn> extends Record<string, infer OO> ? OO extends OutputType ? OO : void : void>(options: {
    fn: Fn;
    batch: BatchTaskConfig & {
        broadcastOutput?: false;
    };
} & Omit<CreateBatchTaskWorkflowOpts<I, O>, 'fn' | 'batch'>, client?: IHatchetClient): TaskWorkflowDeclaration<I, O>;
/**
 * Creates a new workflow instance.
 * @template I The input type for the workflow.
 * @template O The return type of the workflow.
 * @param options The options for creating the workflow. Optionally include a Zod schema
 *                via the `input` field to generate a JSON Schema for the backend.
 * @param client Optional Hatchet client instance.
 * @returns A new Workflow instance.
 */
export declare function CreateWorkflow<I extends InputType = UnknownInputType, O extends OutputType = void>(options: CreateWorkflowOpts, client?: IHatchetClient): WorkflowDeclaration<I, O>;
/**
 * Creates a new durable task workflow declaration with types inferred from the function parameter.
 * @template Fn The type of the durable task function
 * @param options The durable task configuration options.
 * @param client Optional Hatchet client instance.
 * @returns A new TaskWorkflowDeclaration with inferred types.
 */
export declare function CreateDurableTaskWorkflow<Fn extends (input: I, ctx: DurableContext<I>) => O | Promise<O>, I extends JsonObject = Parameters<Fn>[0], O extends JsonObject = ReturnType<Fn> extends Promise<infer P> ? P extends JsonObject ? P : never : ReturnType<Fn> extends JsonObject ? ReturnType<Fn> : never>(options: {
    fn: Fn;
} & Omit<CreateWorkflowDurableTaskOpts<I, O>, 'fn'>, client?: IHatchetClient): TaskWorkflowDeclaration<I, O>;
export {};
