# Findings: loops that execute a plan

This is a survey, not a design. Sources are in `sources.md`. Anything I could not confirm in a primary source is marked unverified.

## How Oskar's workflow looks today

A loop would take a plan like `brainstorms/numeric-schema-version/plan.md` as input. Each step there already has what a runner needs: a title, a "why", a self-contained prompt inside a `text` block, and a "Done when" list. `todo.md` next to it has one checkbox per step and says "Tick a step only when its Done when checks pass". The plan and spec skills already define a divergence rule: "If you found something that was missed, store what you have in spec.md and ask if user would like to go back to q&a."

For Claude Code and Codex, verification already happens outside the model. The Stop hook in `.claude/settings.json` and `.codex/hooks.json` runs `npm run agent:check` when the session edited files. On failure it blocks the stop with exit code 2. It skips the check when `stop_hook_active` is set, so it does not loop. OpenCode only shows a toast and logs the failure; it does not block.

## 1. Ralph loop

### Huntley's original

Huntley's post (https://ghuntley.com/ralph/) defines Ralph as `while :; do cat PROMPT.md | claude-code ; done`.

- Step selection: the model picks. The prompt says to read `fix_plan.md` and "choose the most important thing". Huntley argues that models are good at picking the next thing.
- Context: a fresh process, and so a fresh context, every loop. Memory lives in files (`specs/`, `fix_plan.md`, `AGENT.md`) and in Git.
- Stop condition: none built in. The operator watches and stops it, or it runs out of work. He says he watches `fix_plan.md` "like a hawk" and often deletes and regenerates it.
- Verification: "backpressure" from tests, type checks and static analysis. The agent runs them itself.
- Human review: the operator steers between runs by editing the plan and the prompt.
- Error handling: none. "You'll wake up to a broken codebase that doesn't compile from time to time", and then the operator decides whether to reset or rescue.
- Known failures he lists: placeholder implementations, duplicate code after a failed search, errors in specs that the loop builds faithfully, and context limits. He would not use it "in an existing code base" and expects about 90% done.

### Anthropic's `ralph-loop` plugin

The plugin (https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop) moves the loop inside one Claude Code session. `/ralph-loop "<prompt>" --max-iterations N --completion-promise "DONE"` writes `.claude/ralph-loop.local.md`. The Stop hook (`hooks/stop-hook.sh`) reads that file and the last assistant text. If the text has no `<promise>DONE</promise>`, the hook returns `{"decision": "block", "reason": <the same prompt>}`, and Claude continues.

- Step selection: the model picks, from whatever the prompt says.
- Context: one session, so context grows across iterations. Secondary posts say this is the main difference from Huntley's version, and that fresh context is more stable on long tasks. That is opinion, not measurement.
- Stop condition: an exact string match on the promise, or the iteration cap. The README says the promise "cannot be used for multiple completion conditions (like 'SUCCESS' vs 'BLOCKED')" and tells you to rely on `--max-iterations`.
- Human review: none during the loop. `/cancel-ralph` stops it.
- The README lists what it is "not good for": "Tasks requiring human judgment or design decisions", "Tasks with unclear success criteria", "Production debugging".
- Interplay with Oskar's hook: both are Stop hooks. When the Ralph hook blocks, Claude continues with `stop_hook_active` set, and Oskar's `validate-change.ts` skips the check on the next stop. In a Ralph-style in-session loop, the change check would run only on the first stop of a chain. I got this from reading both hook sources; I did not run it.

### Critiques

- Steve Kinney (https://stevekinney.com/courses/ai-development-setup/patterns-for-running-unattended-work): "An unattended loop with a weak 'done' check doesn't save you time. It produces confident, wrong work faster." He wants an outside check and several limits (iterations, spend, time, stall), and the loop must say which limit fired. "Don't run more agents than you can review." "A gate you approve without reading is just a delay."
- Self-review: several practitioner posts say that a loop which reviews its own work "converges on confidence, not correctness", and that agents write easy tests for themselves. I saw these only through FutureAGI and Reddit search summaries, so they are unverified in full.
- Anthropic's own harness article (https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) reports the same failures from the inside: agents "declaring victory too early" and marking features done after only unit tests. Their fixes are one feature per session and a JSON feature list in which the agent may only flip `passes` ("It is unacceptable to remove or edit tests"). They also keep a progress file, commit once per feature, and run a basic end-to-end check at the start of each session.

## 2. Matt Pocock

Matt Pocock popularised Ralph through AI Hero (https://www.aihero.dev/getting-started-with-ralph, https://www.aihero.dev/tips-for-ai-coding-with-ralph-wiggum).

- Two scripts. `ralph-once.sh` runs `claude --permission-mode acceptEdits "@PRD.md @progress.txt ..."` once, interactively: "watch what Claude does, check the commit, then run it again". `afk-ralph.sh N` runs `docker sandbox run claude --permission-mode acceptEdits -p "..."` up to N times. It exits when the output contains `<promise>COMPLETE</promise>`.
- Step selection: the model picks "the highest-priority task" from the PRD. The prompt ends with "ONLY WORK ON A SINGLE TASK."
- Context: fresh per iteration. State lives in `PRD.md`, `progress.txt` and commits.
- Human review: his first tip is to start human-in-the-loop and switch to AFK only once you trust it. Other tips: "Never outrun your headlights." "Agents amplify what they see."
- Verification: the prompt tells the agent to run tests and type checks before committing. The agent runs them; the script does not check them.

His later library, Sandcastle (https://github.com/mattpocock/sandcastle), is a TypeScript `run()` that wraps the same idea for several agents.

- Agents: Claude Code, Codex, OpenCode, Pi, Copilot and Cursor. The source shows the commands: `claude --print --verbose --output-format stream-json` and `codex exec --json`, both with the prompt on stdin, and `opencode run --format json`.
- Stop: `maxIterations` and a completion signal. It accepts several signals, for example `["TASK_COMPLETE", "TASK_ABORTED"]`, and returns the one that matched. This removes the single-promise limit of the plugin.
- Sessions: it captures each agent's session id and can resume or fork it (`claude --resume <id>`, `codex exec resume <id>`, `opencode run --session <id>`).
- Structured output: the agent prints JSON inside a chosen tag, and Sandcastle validates it against a schema. On failure, Sandcastle resumes the same session with the error, up to `maxRetries`.
- Review: the repo ships an implement prompt and a separate review prompt. The review agent gets the diff to `main` and the issue. It may refine the code and must run typecheck and tests again.
- His skills repo says it is for "real engineering - not vibe coding", and that GSD, BMAD and Spec-Kit "take away your control". That is the same concern Oskar has.

Note: Sandcastle defaults to sandboxes and to `--dangerously-skip-permissions` on AFK runs, and it works through branches and commits. Oskar's AGENTS.md forbids commits unless asked. Using Sandcastle as it is would conflict with that rule; borrowing its ideas would not.

## 3. Gojko Adzic

### The lights-on software factory sample

Gojko published a working sample: https://github.com/gojko/lights-on-software-factory (MIT; created 2026-10-20, last push 2026-10-29). The README calls it "A starting point for running a lights-on software factory with Claude Code (humans supervising agents, deterministic checks providing guardrails instead of markdown prayers, deterministic orchestrator scheduling tasks instead of LLM inference)". It is based on the setup he built for Votito. There, he says the orchestrator "reduced token spend compared to bare-bones Claude workflow execution by around 80%". That figure is self-reported. The workshop page (https://training.techtalk.at/trainings/agentic-software-factory-workshop/) sets "lights-on" against "a vibe-coding dark factory that nobody understands which burns tokens like crazy". It also says the method moves "controls and orchestration from the LLM layer into deterministic tools".

The repo has five parts:

- A sandbox container that shares only the `workspace/` directory with the host.
- A Bash command regulator: a `PreToolUse` hook that inspects each command and approves or denies it.
- A lint hook: a `PostToolUse` hook on every edit.
- A planning flow of three slash commands.
- A deterministic generator that turns the plan into a script for Claude Code's Workflow tool.

How the loop works (from `WORKFLOW.md`, `ORCHESTRATOR.md` and `.claude/commands/execute.md`):

- **You start the plan.** You write `plans/<name>.md` with a problem statement, and anti-goals if you have any.
- **`/impact-analysis <name>` decides WHAT must change, with you.**
  - It reads the plan, the docs, every file the plan names and the tests that cover them.
  - It "checks each claim of the plan about the current code against the source, and says where a claim is out of date".
  - It asks clarifying questions in rounds of up to four.
  - It asks you to classify each out-of-scope item as Next, Later or Never.
  - It appends an Impact Analysis section: clarified requirements with your answers, functional gaps with verification criteria and examples (current behaviour beside the new one, then edge cases), affected files, anti-goals, and risks.
- **`/plan-execution <name>` decides HOW, in three passes, and stops twice for your approval.**
  - Pass 1 is a phase outline you approve: "Present the outline with AskUserQuestion and wait for approval".
  - Pass 2 writes the steps. Each step touches one to four files and one topic, with the test written first in the same step. It names `Files to create/modify/delete`; "Their union is the only set of files its worker may write". It also has a Verification line that runs `jest` and `eslint` on its own files only.
  - Pass 3 proposes groups and dependencies, which you approve. "A group is the smallest set of steps after which the tests and lint pass; a gate runs after each group."
  - The output is the plan prose plus a `plans/<name>.plan.json` sidecar. "An anti-goal is a hard constraint: where a phase cannot respect it, ask the user before you go on."
- **`/execute <name>` runs the plan, with no LLM choosing the next task.**
  - `validate-plan.js` checks the structure and exits 1 with one line per fault.
  - `generate-workflow.js` writes `plans/<name>.workflow.mjs`, which the Workflow tool runs. "Never write a script by hand."
  - The run shape is: group A workers in parallel, then a gate, then group B, and so on to a final barrier and a check.
  - The generator sends only steps that the progress file does not record as complete, so a re-run resumes.
- **Three agent roles are defined in `.claude/agents/`, and the regulator holds each to its role by `agent_type`, "whatever a prompt says".**
  - `workflow-worker` does one step. It verifies only its own files and never commits. "At most three attempts at anything. Then stop and report." It answers a schema: `status` is `done`, `doneWithDeviation`, `notDone`, `noTaskBody` or `noFilesNamed`. The other fields are `summary`, `filesWritten`, `deviation`, `blocker`, `decisionForLaterSteps` and `carryForwardDefect`. "A loud blocker with the task half done is better than a quiet guess that is finished." If the plan file differs from the task body in its prompt, it follows the body and reports the difference as a blocker.
  - `workflow-gate` runs `make workflow-serial-gate` after each group (fast tests) or `make workflow-final-gate` at the end (all tests). It fixes small failures itself, or sends the owning steps back for "at most three rework rounds". Otherwise "the run halts and no later group starts".
  - `workflow-check` runs last and writes nothing. It "tries to refute the claim of each step", answering `held`, `notHeld` or `notProvable`. "Evidence is a file, a line and a name." "A guessed `held` is worse than a gap you show."
- **Progress is recorded deterministically.** "No agent writes the record." While the run goes on, `/loop 10m` calls `record-progress.js`, which appends each agent's answers to `plans/<name>.progress.jsonl`. A step is complete only when the worker said done, its group's gate was green, and no later check claim was `notHeld`. An agent whose transcript has not grown for ten minutes is marked `STUCK` and the script exits 1: "Stop the run, prove the tree by hand, and start it again."
- **After the run:** `show-progress.js --lessons` prints "every blocker, deviation, defect and design decision a worker reported, every gate summary, every claim the check did not hold, every fault of the plan, and what a person said when they ended a run". `measure-run.js` prints time, tool calls and tokens, and you "Propose optimisations from that report, never from a guess".

Where humans review:

- During impact analysis: questions, plus scope calls on each out-of-scope item.
- At two approvals in planning: the phase outline and the groups.
- While the run goes on: progress polls every 10 minutes, with a stop when an agent is stuck.
- After the run: the lessons report.

Workers never ask the human mid-step; they report a blocker in their answer.

How feedback goes back to the agent:

- The lint hook runs `eslint --fix` on each edited `.js` file. If errors remain, it returns a `block` decision with the output, so Claude fixes them before it goes on.
- A refused command gets a reason that "names what to run instead".
- The gate sends rework to the owning step "in the gate's words".
- Gojko's rule for growing the guardrails: "Ask Claude to write more custom rules each time you find yourself providing repetitive design/code feedback", and "Ask Claude to add more custom rules each time it asks you for approval". The two sample lint rules are `no-comments` and `node-protocol-imports`, each with a `RuleTester` test.

How findings lead back to the spec:

- Impact analysis checks the plan's claims against the code before any work starts.
- During a run, a worker reports contradictions between its task, the plan and the tree as blockers. It also reports deviations and decisions for later steps.
- If a plan "needs a shape the notation cannot state, say so in the plan and stop".
- The run only records lessons. I found nothing that sends a run back to `/impact-analysis` or `/plan-execution` automatically. A person reads `--lessons` and decides to edit the plan and re-run, and the generator then sends only the incomplete steps. This is my reading of the docs; they never state a "go back" rule in so many words.

How it verifies steps (at four levels):

- The worker runs `jest` and `eslint` on its own files only.
- The serial gate runs over the merged tree after each group.
- The final gate runs over the whole tree.
- The check agent tries to refute each claim, so it catches "A step that reports `done` and did less" and a claim that no test could report as false.

All gates are `make` goals, so the agent never picks the command.

Agents supported: Claude Code only. It needs Claude Code's Workflow tool (`"enableWorkflows": true`), `/loop`, the Cron tools, agent definitions, and `PreToolUse`/`PostToolUse` hooks. These requirements come from the repo; I did not check the Workflow tool against the Claude Code docs. There is nothing for Codex or OpenCode.

Commits: workers and gates never commit, and the regulator gates mutating Git commands. The person commits the plan, its sidecar and the progress file.

### Talks and other writing

- With Daniel Terhorst-North (https://goto.buzzsprout.com/1714721/episodes/19171518-spec-driven-dev-is-back-but-not-how-you-think-daniel-terhorst-north-gojko-adzic): one-shot "spec-to-product" tools are compared to CASE tools, and tight iterative feedback loops work better. Rules belong in automated lint checks with actionable errors, not in markdown. Humans keep "domain knowledge, semantic correctness, and architectural judgment".
- The talk "Keeping humans in the loop with AI coding agents" (https://gotocph.com/2026/sessions/3977) is based on research of early adopters who avoided "AI slop" with guardrails and feedback loops. The slides for it (https://gojko.net/slides/202609-gotocph.pdf) are linked from the repo README. Not read: the PDF has no extractable text with the tools the research agent had.
- Blog (https://gojko.net/2026/06/24/everyone-will-be-a-pm/): the risk is code that is "a beautifully engineered dish that nobody ordered".

### What maps to Oskar's workflow (evidence only, not a recommendation)

- Gojko's `/impact-analysis` and `/plan-execution` play the same roles as Oskar's brainstorm/specification and plan skills. Both produce acceptance criteria with examples, and both stop for the human between stages.
- Gojko's step format is stricter than Oskar's `plan.md`:
  - It has explicit file lists that bound what a worker may write.
  - It has a per-step verification command.
  - It has a JSON sidecar with groups and dependencies, which a validator checks before anything runs.
- Gojko's gates are `make` goals run by a separate role. Oskar's single gate is the Stop hook running `agent:check`.
- Gojko's worker answer schema (`done`/`doneWithDeviation`/`notDone` plus `deviation`, `blocker`, `decisionForLaterSteps`, `carryForwardDefect`) is a worked example of a structured per-step report that can carry plan divergence.
- Gojko's progress record is written by a script from agent answers, never by an agent. In Oskar's flow the agent ticks `todo.md`.
- Gojko's setup depends on Claude-only features (the Workflow tool, agent definitions), so it does not cover Codex or OpenCode.

## 4. Tools and runners

### Claude Code headless (`claude -p`)

From https://code.claude.com/docs/en/headless and https://code.claude.com/docs/en/cli-reference:

- Exit code is 0 on success and non-zero on failure. A failure inside the run, such as missing authentication, prints as the result on stdout. SIGTERM gives exit 143 and leaves the turn unfinished.
- `--output-format json` returns one object with `result`, `session_id`, cost and usage. `--json-schema '<schema>'` adds `structured_output`. If the run ends without valid structured output, the field is missing, so the caller must check for it.
- `--output-format stream-json --verbose` streams one JSON object per line. The first is `system/init` and the last is a `result` message. `--include-partial-messages` adds token deltas (`stream_event`). `system/api_retry` events report retries. Subagent messages carry `parent_tool_use_id`.
- Sessions: `--session-id <uuid>` sets the id up front. `--resume <id>` continues by id, name or `.jsonl` path. Interactive `claude --continue` skips `-p` sessions, but `claude -p --continue` includes them. So the hand-over from a headless run to a person is interactive `claude --resume <id>`, not `--continue`.
- `--max-turns` and `--max-budget-usd` (print mode only) cap a run.
- Hooks: without `--bare`, a `-p` run loads the project `.claude/settings.json` hooks, CLAUDE.md and skills. So Oskar's Stop hook and AGENTS.md apply to headless runs. `--bare` skips all of that and should not be used here.
- Skills: "Include `/skill-name` in the prompt string and Claude Code expands it."
- Permissions: `--permission-mode` takes `default`, `acceptEdits`, `plan`, `auto`, `dontAsk` or `bypassPermissions`. In `-p` without a mode, calls that need approval are denied. `--permission-prompts none` also removes `AskUserQuestion`, so a headless agent cannot ask the human a question mid-step.

### Claude Code hooks

From https://code.claude.com/docs/en/hooks (read in part):

- Stop fires when Claude finishes responding. SubagentStop fires when a subagent finishes.
- `{"decision": "block", "reason": "..."}` or exit code 2 keeps Claude working. `{"continue": false, "stopReason": "..."}` ends processing and shows the reason.
- Hooks should use `last_assistant_message` instead of reading the transcript, because "the transcript file is written asynchronously and may lag".
- Not verified in the part I read: the exact wording on `stop_hook_active` and infinite loops. Oskar's hook already relies on that field.

### Claude Agent SDK (TypeScript)

From https://code.claude.com/docs/en/agent-sdk/typescript (read in part): `query({prompt, options})` streams messages. The options include `resume`, `sessionId`, `forkSession`, `maxTurns`, `permissionMode`, `settingSources` (loads all settings by default), `outputFormat: {type: 'json_schema', schema}`, `hooks`, `canUseTool`, `abortController` and `systemPrompt: {type: 'preset', preset: 'claude_code', append}`. It gives typed messages and in-process callbacks, but only for Claude. Result subtypes such as `success` and `error_max_turns` come from memory and are unverified.

### Codex (`codex exec`)

From https://learn.chatgpt.com/docs/non-interactive-mode:

- Progress goes to stderr and the final message to stdout. `--json` turns stdout into JSONL with these events: `thread.started` (carries `thread_id`), `turn.started`, `item.started` and `item.completed` (items such as `command_execution`, `agent_message`, file changes and plan updates), `turn.completed` (usage), `turn.failed` and `error`.
- `--output-schema <file>` asks for a schema-shaped final answer. `-o <path>` writes the last message to a file.
- `codex exec resume <SESSION_ID>` or `--last` continues headless. Interactive `codex resume` reopens a recent chat. Unverified: whether sessions made by `codex exec` show in the interactive picker or open with `codex resume <id>`.
- The default sandbox is read-only. `--sandbox workspace-write` allows edits. `--full-auto` is no longer supported.
- That page does not document exit codes, or whether `.codex/hooks.json` Stop hooks fire under `codex exec`. Both are unverified.

### OpenCode (`opencode run`)

From the CLI docs in the repo (https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/cli.mdx):

- `opencode run [message..]` takes `--format json` ("raw JSON events"), `--session/-s <id>`, `--continue/-c`, `--fork`, `--agent`, `--model`, `--title` and `--auto`.
- Interactive hand-over: `opencode --session <id>` opens the TUI on that session.
- `opencode session list --format json` and `opencode export <id>` give session data.
- The docs do not list the JSON event names. Sandcastle's parser reads `step_start` (with `sessionID`), `text`, `tool_use`, `step_finish` (tokens) and `error`. Treat these as observed, not documented.
- Oskar's OpenCode plugin runs the check on the `session.status` idle event. It is unverified whether that event fires the same way under `opencode run`. The plugin does not block in either case.

### Plan and task runners

- Harper Reed (https://harper.blog/2025/02/16/my-llm-codegen-workflow-atm/), the source of Oskar's skills: the human pastes each prompt from `prompt_plan.md`, runs the tests, then decides whether to "advance or debug". `todo.md` keeps state across sessions. He warns about getting "over my skis". Nothing in his workflow automates the loop itself.
- spec-kit `/implement` (https://github.com/github/spec-kit/blob/main/templates/commands/implement.md): one agent session reads `tasks.md` and runs the tasks in order. Its rules: "Report progress after each completed task", "Halt execution if any non-parallel task fails", and mark each task `[X]`. It asks the user before starting when checklists are incomplete, and it has `before_implement` and `after_implement` hooks in `.specify/extensions.yml`.
- Kiro (https://kiro.dev/docs/specs/): specs have requirements, design and tasks files. You can run one task or all of them; "run all" works through dependency waves and shows status live. The docs do not describe per-task approval.
- Taskmaster: `task-master next` gives the next task whose dependencies are done. Source is mirror docs only.
- BMAD and GSD: not researched in depth. Matt Pocock lists them with spec-kit as tools that "take away your control".

## 5. Patterns asked about

### Live progress in headless mode

- Claude Code: read the `stream-json` lines. These events are useful:
  - `system/init`: session id, model and tools.
  - `assistant` messages with `tool_use` blocks: which tool, file or command.
  - `user` messages with `tool_result`.
  - `system/api_retry`.
  - The final `result`: status, cost and session id.
  Token-level text needs `--include-partial-messages`.
- Codex: read the `--json` lines. `thread.started` gives the id. `item.started` with `command_execution` shows each command, and `item.completed` with `agent_message` gives text. `turn.completed` gives usage; `turn.failed` and `error` give failures.
- OpenCode: read the `--format json` lines. Observed events (per Sandcastle): `step_start`, `text`, `tool_use`, `step_finish` and `error`.
- Sandcastle shows the common shape: one parser per agent that maps lines to a small set of events (text, tool call, session id, usage, error). Its `onAgentStreamEvent` callback is one way for a runner to surface them.

### Hand-over of a failed headless run to a person

- Claude Code: keep the `session_id` from `system/init` or from the `result`, or set it up front with `--session-id`. Then `claude --resume <id>` opens the session interactively with full history. `claude --continue` does not work here, because it skips `-p` sessions.
- Codex: `codex exec resume <id>` is documented for headless runs. Interactive resume of an exec session is unverified.
- OpenCode: `opencode --session <id>` opens the TUI.
- For an interactive child, the runner hands it the terminal with execa `stdio: 'inherit'` (see below). The runner waits until the person exits, then continues or stops.

### Pausing for human review

- Huntley: no pause. The human edits the plan between runs.
- Pocock: `ralph-once.sh` is the pause. It runs one step, then the human looks and runs it again.
- spec-kit: stops on checklist gaps and on a failed task.
- Kinney: a gate approved without reading is "just a delay", so a pause should show something worth reading (the diff, test output, a report).
- The pattern in all of them: pause between steps, outside the agent, with a short report and the diff.

### Structured per-step reports

- Three mechanisms exist: Claude Code `--json-schema` with `structured_output`, Codex `--output-schema`, and Sandcastle's tag-plus-schema approach for agents without native support.
- Sandcastle shows a fix for invalid output: resume the same session with the validation error, up to a retry cap.
- Unlike the Ralph promise, these allow several outcome values. Sandcastle's `["TASK_COMPLETE","TASK_ABORTED"]` is the minimal form.

### Detecting plan divergence

- No tool I found detects divergence automatically. All of them rely on the agent saying so.
- The closest thing to structured divergence reporting is Gojko's worker answer schema (`deviation`, `blocker`, `decisionForLaterSteps`, `carryForwardDefect`) together with his check agent, which tries to refute each step's claim.
- The Ralph plugin cannot express divergence, because it has a single promise string. Sandcastle can, through a second signal or a schema field.
- With `--permission-prompts none`, Claude cannot use `AskUserQuestion`. A headless agent can then report divergence only in its final output, and the runner must stop on it.
- Oskar's plan and spec skills already define the human side: write what was found to `spec.md` and ask about going back to Q&A.

### Verification gates outside the agent

- Anthropic's harness article and Kinney both say the agent should not grade itself.
- Oskar already has one gate outside the model: the Stop hook that runs `agent:check`. It runs inside the agent session, so it feeds failures back to the agent, but the agent cannot skip it.
- A runner can also run the step's "Done when" commands itself after the agent exits and use their exit codes instead of the agent's report. Examples: `npm run agent:check`, `npm run test:unit`, or a specific `npx vitest run`.
- Gojko's point fits here: put rules in lint and CI checks with actionable messages, not in prompt text.

### execa for running the CLIs

From https://github.com/sindresorhus/execa (version 10.2.1, Node `>=22`; the repo uses Node 24):

- Streaming lines: `for await (const line of execa\`claude -p ...\`)` yields stdout lines while the process runs, and `.iterable({from: 'stderr'})` reads stderr. Each JSON line is then parsed with `JSON.parse(line)`. The iteration "throws if the subprocess fails".
- Prompt on stdin: the `input` option passes a string. Sandcastle sends prompts on stdin for Claude and Codex.
- Exit codes: a non-zero exit rejects with an `ExecaError` that has `exitCode`, `failed`, `timedOut`, `isCanceled`, `isTerminated` and `shortMessage`. With `reject: false`, execa returns the result instead of throwing.
- Interactive hand-over: `stdio: 'inherit'` gives the child the terminal. The docs warn that if you mix `'inherit'` with other targets (for example `['inherit', 'pipe']`), the fd "will never refer to a TTY". An interactive session therefore needs plain `'inherit'`.
- Cancel: `cancelSignal` from an `AbortController` sends SIGTERM. `timeout` and `forceKillAfterDelay` also exist. The Claude docs say SIGTERM exits 143 and leaves the turn unfinished, while SIGINT ends the turn.
- Trade-off: `.agents` has no dependencies today, and the hooks use `node:child_process` `spawn`. execa would be the first dependency there. Plain `spawn` with `readline` can do the same with more code.

### Light extension points seen in other loops

- Review after each task: Sandcastle has a separate review prompt that sees the diff and must re-run typecheck and tests. The `thecraighewitt/ralph` skill advertises "a code review gate after every iteration"; I saw the listing only.
- Before and after hooks: spec-kit has `before_implement` and `after_implement` in `.specify/extensions.yml`. Sandcastle has `onWorktreeReady` and `onSandboxReady`.
- Start-of-step health check: Anthropic's harness runs a basic end-to-end check before new work. It catches a broken state left by the previous step.
- Each of these is one extra command or prompt at a fixed point, not a framework.

## Fit with Oskar's workflow

These are the concrete options seen in the research, with their trade-offs. There is no recommendation.

- **In-session Stop-hook loop (Ralph plugin style).** It works inside one Claude Code session, reuses the existing hooks setup, and needs no new process. Trade-offs:
  - Context grows across steps.
  - The existing `stop_hook_active` guard means `agent:check` would run only on the first stop of a chain.
  - One promise string cannot say done vs blocked vs diverged.
  - It works only with Claude.
- **External script that runs one headless agent process per step (Huntley, Pocock, Sandcastle style).** Each step gets a fresh context. The runner owns step selection from `todo.md`, the pause, the gates and the report. The same shape works for `claude -p`, `codex exec` and `opencode run`. Trade-offs:
  - It is a small script to maintain.
  - Output parsing differs per agent.
  - Codex and OpenCode details are unverified (hooks in headless mode, interactive resume of exec sessions).
- **Agent SDK in TypeScript.** It gives typed messages, `canUseTool`, in-process hooks and `outputFormat`. The trade-off: it works only with Claude, so Codex and OpenCode need a separate path.
- **Use Sandcastle.** It already supports several agents, with sessions, resume, structured output and review prompts. Trade-offs: it is built around sandboxes, branches and commits, and bypasses permissions by default, while Oskar's rules forbid commits unless asked. It is also a framework, which Oskar wants to avoid.
- **Gojko's lights-on factory: a deterministic generator plus the Claude Code Workflow tool.** Steps run as worker, gate and check roles, progress comes from a script, and the human approves the plan in stages. Trade-offs: Claude-only, more machinery, and a stricter plan format (file lists, per-step verification, JSON sidecar).
- **Single-session command like spec-kit `/implement`.** One prompt walks `todo.md` and halts on failure. It is easy to write as one more skill. Trade-offs: the agent grades itself and decides when to stop, and context grows.

These pieces can be reused as they are:

- `plan.md` steps already have self-contained prompts and "Done when" lists. A runner can pick the next unchecked `todo.md` line and send its step prompt without the model choosing the task.
- The Stop hook already blocks on an `agent:check` failure in headless Claude runs, because hooks load in `-p` without `--bare`.
- `claude --resume <id>` is the documented hand-over from a headless run to an interactive one.
- The plan and spec skills already define what "go back to Q&A" means.

There are three tension points:

- AGENTS.md says "Do not commit". Most loops (Huntley, Pocock, the Anthropic harness, Sandcastle) commit per step so that progress is reviewable and revertible. Without commits, the per-step diff must come from somewhere else, such as `git diff` against a snapshot or `jj` changes.
- AGENTS.md says "ask instead of assuming". A headless run cannot ask mid-step: `AskUserQuestion` is removed with `--permission-prompts none`, and calls that need approval are denied in `-p`. The agent can only stop and report.
- Someone has to tick `todo.md`. Either the agent does it (as in Harper Reed and spec-kit), or the runner does it after its own checks pass (closer to Anthropic's "only flip passes" rule).

## Open questions for Oskar

1. Fresh context per step (one agent process per step), or one session that walks the whole plan?
2. Should the loop commit after each step, or never commit and show `git diff` (or a `jj` change) at each pause? This touches the AGENTS.md "Do not commit" rule.
3. Who ticks a step in `todo.md`: the agent, or the runner after its own checks pass?
4. Which checks should the runner run itself after each step: only `agent:check`, also `test:unit`, or the exact test files the step names? Should the "Done when" list become machine-readable for that?
5. What should a per-step report contain at minimum (status, files changed, tests run with results, open concerns, divergence notes)?
6. What counts as divergence: any change to a file the step did not name, any new decision not in `spec.md`, or only what the agent flags?
7. When should the loop pause for review: after every step, only on chosen steps, or only on failure? Should a step in `plan.md` be able to say "stop for review after this"?
8. On error, how many automatic troubleshooting attempts should run before the loop hands over to you? Should the troubleshooting agent resume the same session, or start fresh with the error?
9. When it hands over interactively, should the loop wait and continue after you exit `claude --resume <id>`, or stop and let you restart it?
10. For Codex and OpenCode: is "runs the same steps headless and reports" enough, or do they also need the interactive hand-over and blocking checks from day one?
11. Is a small dependency such as execa fine in `.agents`, or should the script stay on `node:child_process` like the current hooks?
12. Should a separate review agent look at each step's diff (as in Sandcastle), or is your own review at the pause the only review?
13. Besides a step count, which limits matter to you: `--max-turns`, `--max-budget-usd`, wall time?
14. Should the loop be a script you start from the terminal, or a skill you start inside Claude Code that then shells out?
