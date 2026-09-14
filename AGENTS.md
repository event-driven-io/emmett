# Emmett

Emmett is an Event Sourcing library for Node.js and TypeScript.

## Repository structure

Repository is using npm workspaces rooted at `src`.

Core:

- `src/packages/emmett`: core Event Sourcing building blocks.
- `src/packages/almanac`: opinionated observability for event-driven systems.

Event store drivers:

- `src/packages/emmett-postgresql`: PostgreSQL event store.
- `src/packages/emmett-sqlite`: SQLite event store.
- `src/packages/emmett-mongodb`: MongoDB event store.
- `src/packages/emmett-esdb`: EventStoreDB event store.

Web framework bindings:

- `src/packages/emmett-expressjs`: Express.js Web Api bindings.
- `src/packages/emmett-honojs`: Hono.js Web Api bindings.
- `src/packages/emmett-fastify`: Fastify Web Api bindings.

Tooling:

- `src/packages/emmett-testcontainers`: Testcontainers helpers for integration tests.
- `src/packages/emmett-tests`: internal end-to-end tests.

Besides that:

- `src/docs`: documentation.
- `src/e2e`: end-to-end and bundle tests.
- `src/rfc`: design RFCs.
- `samples`: usage examples.

## Agent skills

Shared skills live in `.agents/skills/<name>/SKILL.md`. That file is the canonical body, so edit the skill there.

Codex and OpenCode read `.agents/skills/` directly. Claude Code does not, so `.claude/commands/<name>.md` holds a thin pointer that reads the skill file. OpenCode also gets a pointer in `.opencode/commands/<name>.md`, which exposes the skill as a `/name` slash command.

When adding a skill, write the body in `.agents/skills/` with `name` and `description` in the front matter, then add both pointer files.

## Development

Run development commands from `src`.

- Use `npm run build:ts` for routine TypeScript validation.
- Do not run `npm run build` unless the user explicitly requests a complete package build.
- Use `npm run agent:check` to apply formatting and lint fixes, then type-check.
- Use `npm run docs:build` to build the documentation.

### Testing

Tests are implemented using Vitest. Run a specific test file with, for example:

```shell
npx vitest run packages/emmett/src/commandHandling/handleCommand.unit.spec.ts
```

Use `-t` to run a specific test case:

```shell
npx vitest run packages/emmett/src/commandHandling/handleCommand.unit.spec.ts -t "test name"
```

Available test suites:

- `npm run test:unit`: run the unit tests. These are fast and avoid external I/O.
- `npm run test:int`: run the integration tests. These use external I/O and may start Docker containers through Testcontainers.
- `npm run test:e2e`: run the end-to-end usage scenarios.
- `npm test`: run the unit, integration, and end-to-end test suites.

## Verification

The completion hook runs `npm run agent:check` automatically.

For documentation or agent-configuration changes, validate only the changed files and configuration. Application test suites are not required.

While changing application code, identify and run the smallest relevant set of tests covering the affected behavior and applicable backends or variants. Before reporting a development phase as complete, also run `npm run test:unit`.

Before the final handoff of completed application-code work, run `npm test`.

Report which verification commands were run, whether they passed, and why any relevant checks were skipped.

## Working rules

- Use simple, direct language. Keep explanations concise, example-based, and focused on the problem. Simplify without oversimplifying.
- If a requirement or intended behavior is unclear, ask instead of assuming.
- Do not monkey-patch globals, prototypes, or third-party modules. If a change appears to require monkey-patching, stop and ask first.
- Prefer simple, easily removable code over premature abstractions. Do not introduce a new abstraction unless explicitly requested.
- Use a test-first approach for behavior changes. Name tests after observable behavior from the usage perspective, not implementation details.
- Treat questions, design discussions, and requests for opinions as read-only. Wait for explicit approval before editing files or running mutating commands.
- Use subagents, when available, for independent work that can usefully run in parallel, such as research, repository exploration, focused implementation, verification, and review. Keep user interaction, cross-cutting decisions, and final synthesis in the main context. Give subagents sufficient context and require concrete, evidence-backed findings so important details are not lost.
- Do not commit, create branches or tags, rebase, reset, or otherwise modify Git history unless explicitly requested.
- Do not add manual line breaks inside Markdown paragraphs. Keep each paragraph on a single line and let the renderer or editor wrap it.

## Coding guide

- Use the module pattern with functions, closures, and object literals instead of classes.
