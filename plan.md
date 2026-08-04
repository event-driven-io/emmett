# Issue #375 plan: event-store-backed workflow processors for MongoDB and ESDB

## Goal

Implement real `workflowProcessor` support for:

- `mongoDBEventStoreConsumer`
- `eventStoreDBEventStoreConsumer`

The implementation must follow the PostgreSQL workflow processor pattern and the PostgreSQL workflow integration test behavior.

Canonical references:

- `src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLProcessor.ts`
- `src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.workflow.int.spec.ts`

## Non-negotiable implementation rules

1. Start with tests.
2. The MongoDB and ESDB workflow integration specs are ports of the PostgreSQL workflow spec, not reduced variants.
3. The store-specific workflow processor implementations must be ports of `postgreSQLWorkflowProcessor`, translated only for store-specific:
   - processing scope
   - checkpointing
   - client / connection / store injection
   - lock behavior
4. Do not keep `unsupportedWorkflowProcessor` wired into MongoDB or ESDB consumers.
5. Preserve existing consumer registration semantics:
   - `consumer.workflowProcessor(existingProcessor)` still registers and returns the processor unchanged.

## Parallelisation strategy

This work splits cleanly into a shared preparation step and two independent implementation tracks.

- Shared track:
  - prepare the test ports
  - define the exact PostgreSQL-to-store translation rules
  - update any common expectations around unit tests
- Track A:
  - MongoDB workflow processor + MongoDB workflow tests
- Track B:
  - ESDB workflow processor + ESDB workflow tests

Recommended subagent split:

- Subagent 1: MongoDB track
- Subagent 2: ESDB track
- Main agent: shared prep, final consistency pass, final verification

## Step-by-step plan

### Step 1 — Port PostgreSQL workflow integration tests first

Create store-specific workflow integration specs by porting:

- `src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLEventStoreConsumer.workflow.int.spec.ts`

Target files:

- `src/packages/emmett-mongodb/src/eventStore/consumers/mongoDBEventStoreConsumer.workflow.int.spec.ts`
- `src/packages/emmett-esdb/src/eventStore/consumers/eventStoreDBEventStoreConsumer.workflow.int.spec.ts`

Rules for the port:

- Keep the same domain fixtures and workflow options structure:
  - `GroupCheckoutWorkflow`
  - `WorkflowHandler`
  - `workflowOutputHandler`
  - `workflowStreamName`
  - `workflowProcessorOptions`
- Keep the same scenario coverage and assertion intent.
- Keep the same event ordering assertions on workflow streams.
- Adapt only store bootstrap / lifecycle / timing / append-wait mechanics to the target store.

The ported specs must cover all PostgreSQL scenarios:

1. `processes InitiateGroupCheckout and produces GroupCheckoutInitiated and CheckOut messages`
2. `completes group checkout after all guests check out`
3. `ignores messages when getWorkflowId returns null`
4. `processes messages directly in regular mode (separateInputInboxFromProcessing: false)`
5. `stores input first then processes in double-hop mode (separateInputInboxFromProcessing: true)`
6. `completes group checkout when GuestCheckedOut arrives on external stream`
7. `completes group checkout when output handler returns input message tagged for decide`
8. `processes external events in double-hop mode after storing with prefix`

Notes per store:

- MongoDB:
  - use the shared MongoDB test database setup already used by MongoDB consumer integration tests
  - preserve direct-connection settings if existing MongoDB tests require them
- ESDB:
  - use the EventStoreDB container-based setup already used by ESDB integration tests
  - if subscription visibility lags behind append completion, add the same kind of explicit wait logic already used in ESDB consumer tests before asserting workflow results

### Step 2 — Update unit tests to reflect real workflow support

Update:

- `src/packages/emmett-mongodb/src/eventStore/consumers/mongoDBEventStoreConsumer.unit.spec.ts`
- `src/packages/emmett-esdb/src/eventStore/consumers/eventStoreDBEventStoreConsumer.unit.spec.ts`

Required changes:

- remove assertions that `consumer.workflowProcessor({ workflow: {} })` throws
- keep assertions that:
  - `workflowProcessor` exists
  - existing processors can be registered via `workflowProcessor`
  - store-created consumers still expose the typed API
- add a minimal assertion that a real workflow processor can be created without throwing when given valid workflow options

Use the smallest valid workflow fixture needed for unit scope. Do not duplicate the full integration scenarios here.

### Step 3 — Implement MongoDB workflow processor

Primary implementation reference:

- `postgreSQLWorkflowProcessor` in `src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLProcessor.ts`

Create MongoDB equivalents in:

- `src/packages/emmett-mongodb/src/eventStore/consumers/mongoDBProcessor.ts`
- `src/packages/emmett-mongodb/src/eventStore/consumers/mongoDBEventStoreConsumer.ts`

Required implementation shape:

1. Add MongoDB workflow processor option/type aliases analogous to PostgreSQL:
   - workflow processor options
   - workflow-capable handler context
   - workflow processor factory type
2. Add a workflow-capable MongoDB processing scope.
3. Add `mongoDBWorkflowProcessor(...)` that mirrors the PostgreSQL assembly pattern:
   - derive `processorId`
   - derive `processorInstanceId`
   - set `version`
   - set `partition`
   - prepare hooks
   - call core `workflowProcessor(...)`
   - pass workflow-capable `processingScope`
   - pass MongoDB checkpointer unless checkpoints are disabled

PostgreSQL-to-MongoDB translation rules:

- No processor lock layer.
- No PostgreSQL pool creation logic.
- Reuse the consumer client.
- The workflow-capable processing scope must inject:
  - `context.client`
  - `context.connection.messageStore`
  - `context.observabilityScope`
- `context.connection.messageStore` must be built with `getMongoDBEventStore({ client })`.
- The message store must be borrowed, not owned by the workflow processor.
- Checkpointing uses `mongoDBCheckpointer`.
- If checkpoints are disabled, use `inMemoryCheckpointer`, matching the PostgreSQL pattern.

Consumer wiring changes:

- Replace `unsupportedWorkflowProcessor` as the consumer workflow factory.
- Add a real `MongoDBWorkflowProcessorFactory` type to the consumer type definition.
- Ensure `mongoDBEventStoreConsumer(...).workflowProcessor(...)` uses the same client ownership model as the rest of the consumer:
  - consumer-created client closes once on consumer close
  - injected client is not closed by the workflow processor

### Step 4 — Implement ESDB workflow processor

Primary implementation reference:

- `postgreSQLWorkflowProcessor` in `src/packages/emmett-postgresql/src/eventStore/consumers/postgreSQLProcessor.ts`

Create ESDB equivalents in:

- `src/packages/emmett-esdb/src/eventStore/consumers/eventStoreDBEventStoreConsumer.ts`
- a new ESDB processor helper module if needed, preferably:
  - `src/packages/emmett-esdb/src/eventStore/consumers/eventStoreDBProcessor.ts`

Required implementation shape:

1. Add ESDB workflow processor option/type aliases analogous to PostgreSQL.
2. Add a workflow-capable ESDB processing scope.
3. Add `eventStoreDBWorkflowProcessor(...)` that mirrors the PostgreSQL assembly pattern:
   - derive `processorId`
   - derive `processorInstanceId`
   - set `version`
   - set `partition`
   - prepare hooks
   - call core `workflowProcessor(...)`
   - pass workflow-capable `processingScope`
   - pass the ESDB checkpointer strategy

PostgreSQL-to-ESDB translation rules:

- No processor lock layer.
- No SQL connection or transaction plumbing.
- Reuse the consumer client.
- The workflow-capable processing scope must inject:
  - `context.connection.messageStore`
  - `context.observabilityScope`
- `context.connection.messageStore` must be built with `getEventStoreDBEventStore(client)`.
- The message store must be borrowed, not owned by the workflow processor.
- Keep checkpointing consistent with the current ESDB consumer processor model:
  - use `inMemoryCheckpointer`
  - do not introduce a new persisted ESDB processor checkpoint implementation as part of this issue

Consumer wiring changes:

- Replace `unsupportedWorkflowProcessor` as the consumer workflow factory.
- Add a real `EventStoreDBWorkflowProcessorFactory` type to the consumer type definition.
- Preserve current client ownership:
  - consumer-created client is disposed on consumer close
  - injected client is not disposed by the workflow processor

### Step 5 — Make event-store-created consumers behave the same way

Verify that these convenience APIs automatically benefit from the new workflow support:

- `getMongoDBEventStore(...).consumer()`
- `getEventStoreDBEventStore(...).consumer()`

Required outcome:

- they expose the real workflow processor factory
- they no longer rely on the throwing placeholder
- they inherit the same store/client ownership rules as direct consumer construction

### Step 6 — Verification

Run verification in this order:

1. targeted unit tests for MongoDB consumer
2. targeted unit tests for ESDB consumer
3. MongoDB workflow integration spec
4. ESDB workflow integration spec
5. any existing consumer integration suites that overlap enough to catch regressions in source handling or ownership

Minimum acceptance checks:

- MongoDB workflow stream persists prefixed inputs and workflow outputs exactly as asserted by the PostgreSQL spec port
- ESDB workflow stream persists prefixed inputs and workflow outputs exactly as asserted by the PostgreSQL spec port
- output-handler re-entry path works for both stores
- no consumer unit test still expects unsupported workflow behavior
- no client lifetime regressions

## Suggested execution order with parallel work

### Main agent

1. Port the PostgreSQL workflow spec skeleton into both target files.
2. Extract the exact PostgreSQL workflow processor assembly checklist from `postgreSQLWorkflowProcessor`.
3. Hand MongoDB and ESDB tracks off in parallel.
4. Reconcile naming, type shapes, and unit-test expectations.
5. Run final combined verification.

### Subagent 1 — MongoDB

1. Finish MongoDB workflow integration spec port.
2. Update MongoDB unit tests.
3. Implement MongoDB workflow-capable processing scope.
4. Implement `mongoDBWorkflowProcessor`.
5. Wire the consumer to use it.
6. Run MongoDB-targeted tests and fix issues.

### Subagent 2 — ESDB

1. Finish ESDB workflow integration spec port.
2. Update ESDB unit tests.
3. Implement ESDB workflow-capable processing scope.
4. Implement `eventStoreDBWorkflowProcessor`.
5. Wire the consumer to use it.
6. Run ESDB-targeted tests and fix issues.

## Done definition

The issue is done when:

- both consumers expose real workflow processors
- both workflow processors persist workflow output via the store event store
- the unsupported placeholder is no longer injected in MongoDB or ESDB consumers
- MongoDB and ESDB workflow integration specs are store-specific ports of the PostgreSQL workflow spec
- targeted unit and integration tests pass for both stores
