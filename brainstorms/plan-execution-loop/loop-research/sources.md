# Sources

Each entry has the URL and a short note on what it says. Fetched on 2026-11-08.

## Repository context

- `/home/oskar/repos/emmett/AGENTS.md`: working rules, verification commands (`npm run agent:check`, `npm run test:unit`, `npm test`), ask instead of assume, no Git history changes unless asked.
- `/home/oskar/repos/emmett/.agents/README.md`: shared skills and the change-check hooks. Stop hook runs `agent:check` only when the session edited files, blocks with exit code 2 on failure, skips when `stop_hook_active` is set.
- `/home/oskar/repos/emmett/.agents/skills/brainstorm/SKILL.md`, `specification/SKILL.md`, `plan/SKILL.md`: the brainstorm, spec, plan chain that writes `qa.md`, `spec.md`, `plan.md`, `todo.md`. The plan and spec skills already say "store what you have in spec.md and ask if user would like to go back to q&a" when something was missed.
- `/home/oskar/repos/emmett/brainstorms/numeric-schema-version/plan.md` and `todo.md`: the example input. Each step has a `text` prompt block with "Done when" checks; `todo.md` has one checkbox per step and the rule "Tick a step only when its Done when checks pass".
- `/home/oskar/repos/emmett/.agents/hooks/validate-change.ts`: hook code uses `node:child_process` `spawn`, with no third-party dependencies. `.agents/package.json` has no dependencies. `src/package.json` requires Node `>=24.22.1`.

## Ralph loop

- https://ghuntley.com/ralph/ : Geoffrey Huntley's original post. Ralph is `while :; do cat PROMPT.md | claude-code ; done`. Fresh context each loop, one item per loop, `fix_plan.md` as the task list, specs in `specs/`, `AGENT.md` for build and run learnings, "backpressure" from tests and type checks. He says he would not use it in an existing code base and expects about 90% done.
- https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop : Anthropic's `ralph-loop` plugin (README). `/ralph-loop "<prompt>" --max-iterations N --completion-promise "TEXT"`, `/cancel-ralph`. Loop runs inside the current session through a Stop hook. Says it is "not good for tasks requiring human judgment or design decisions". Notes that the completion promise is an exact string, so it cannot express "SUCCESS" vs "BLOCKED".
- https://github.com/anthropics/claude-plugins-official/blob/main/plugins/ralph-loop/hooks/stop-hook.sh : the hook source. Reads state from `.claude/ralph-loop.local.md`, checks the session id, reads the last assistant text from the transcript, looks for `<promise>…</promise>`, otherwise returns `{"decision":"block","reason":<same prompt>}`.
- https://shiqimei.github.io/posts/ralph-wiggum-loop-claude-code and https://www.dreamhost.com/blog/es/plugin-ralph-wiggum/ : secondary posts comparing the in-session plugin with the fresh-context bash loop (context accumulates in the plugin version). Opinion, not measured.
- https://stevekinney.com/courses/ai-development-setup/patterns-for-running-unattended-work : "An unattended loop with a weak 'done' check ... produces confident, wrong work faster." Several limit types (iterations, spend, time, stall), the loop must say which limit fired, "Don't run more agents than you can review", "a gate you approve without reading is just a delay".
- https://futureagi.com/blog/ralph-loop-production-failure-modes/ : practitioner list of Ralph failure modes, including self-review that "converges on confidence, not correctness" (seen via search summary only, not read in full).
- https://tessl.io/blog/unpacking-the-unpossible-logic-of-ralph-wiggumstyle-ai-coding : summary of community debate; critics worry about biased self-written tests, defenders say critiques mark the limits of where the loop fits (seen via search summary only).

## Matt Pocock

- https://www.aihero.dev/getting-started-with-ralph : `ralph-once.sh` (human-in-the-loop, one run, `claude --permission-mode acceptEdits "@PRD.md @progress.txt ..."`) and `afk-ralph.sh` (capped loop with `docker sandbox run claude --permission-mode acceptEdits -p`, stops on `<promise>COMPLETE</promise>`). "ONLY WORK ON A SINGLE TASK."
- https://www.aihero.dev/tips-for-ai-coding-with-ralph-wiggum : tips: start HITL then AFK, always cap iterations, keep progress file short, "the more loops you give it, the higher quality code", "Never outrun your headlights", do risky spikes first, "Agents amplify what they see", sandbox AFK runs.
- https://github.com/mattpocock/sandcastle : TypeScript library `run()` for sandboxed agent runs; supports Claude Code, Codex, OpenCode, Pi, Copilot, Cursor.
- https://github.com/mattpocock/sandcastle/blob/main/docs/guide/iterations.md : `maxIterations`, completion signal (default `<promise>COMPLETE</promise>`), several signals allowed (`["TASK_COMPLETE","TASK_ABORTED"]`), idle and completion timeouts for hanging processes.
- https://github.com/mattpocock/sandcastle/blob/main/docs/guide/agent-sessions.md : captures session ids, resume and fork per agent: `claude --resume <id>`, `codex exec resume <id>`, `opencode run --session <id>`, plus fork flags.
- https://github.com/mattpocock/sandcastle/blob/main/docs/guide/structured-output.md : agent prints JSON inside a chosen XML tag, validated against a Standard Schema; on failure it resumes the same session with the error, up to `maxRetries`.
- https://github.com/mattpocock/sandcastle/blob/main/docs/guide/run-logs.md : log to file or terminal, `onAgentStreamEvent` callback per text chunk and tool call.
- https://github.com/mattpocock/sandcastle/blob/main/src/AgentProvider.ts : concrete CLI invocations: `claude --print --verbose --output-format stream-json` with prompt on stdin; `codex exec --json` (prompt on stdin); `opencode run --format json`. Also the event types it parses per CLI.
- https://github.com/mattpocock/sandcastle/blob/main/.sandcastle/implement-prompt.md and `.sandcastle/review-prompt.md` : implement prompt (one issue, red-green-refactor, typecheck and test before commit, `<promise>COMPLETE</promise>`), then a separate review prompt that sees the diff and may refine code.
- https://github.com/mattpocock/skills : "Skills For Real Engineers ... not vibe coding." Says GSD, BMAD and Spec-Kit "take away your control"; his skills are small and composable.

## Gojko Adzic

- https://goto.buzzsprout.com/1714721/episodes/19171518-spec-driven-dev-is-back-but-not-how-you-think-daniel-terhorst-north-gojko-adzic : GOTO episode page with Daniel Terhorst-North. One-shot spec-to-product is compared to CASE tools; tight iterative feedback loops work better; encode rules as automated lint checks in CI with actionable errors instead of markdown; humans keep domain knowledge, semantic correctness and architecture judgement; "Automation makes things faster — Not better." Show notes only, no transcript.
- https://gotocph.com/2026/sessions/3977 : abstract of "Keeping humans in the loop with AI coding agents": research of early adopters, stages of adoption, guardrails and feedback loops to keep humans in control. Abstract only.
- https://m.devoxx.com/events/devoxxpl26/talks/9631/keeping-humans-in-the-loop-with-ai-coding-agents : same talk abstract, adds "guardrails and constraints" so agents produce human-level code faster.
- https://gojko.net/2026/06/24/everyone-will-be-a-pm/ : agents let more people build; risk is "a beautifully engineered dish that nobody ordered"; product judgement matters more.
- https://gotopia.tech/sessions/4066/spec-driven-development-is-back-but-not-how-you-think : session page for the same conversation (not read in full).
- https://github.com/gojko/lights-on-software-factory : Gojko's lights-on software factory boilerplate for Claude Code (MIT, Oct 2026). README: humans supervise, deterministic checks instead of "markdown prayers", deterministic orchestrator instead of LLM scheduling; about 80% lower token spend on Votito (self-reported).
- https://github.com/gojko/lights-on-software-factory/blob/main/WORKFLOW.md : user flow `/impact-analysis`, then `/plan-execution` (two approval stops: phase outline, groups), then `/execute`; plan file plus `.plan.json` sidecar plus `.progress.jsonl`.
- https://github.com/gojko/lights-on-software-factory/blob/main/ORCHESTRATOR.md : validator and generator write a Workflow script; worker, gate and check roles; serial and final `make` gate goals; at most three rework rounds then halt; progress derived from agent answers; resume sends only incomplete steps; `STUCK` after ten idle minutes.
- https://github.com/gojko/lights-on-software-factory/blob/main/workspace/.claude/commands/execute.md : when a workflow is right, "Never write a script by hand", poll with `/loop 10m` and `record-progress.js`, read lessons with `show-progress.js --lessons`, measure with `measure-run.js`, resume semantics.
- https://github.com/gojko/lights-on-software-factory/blob/main/workspace/.claude/commands/plan-execution.md : three passes, AskUserQuestion approval of phases, step format with file lists and per-step jest/eslint verification, anti-goals are hard constraints.
- https://github.com/gojko/lights-on-software-factory/blob/main/workspace/.claude/commands/impact-analysis.md : clarifying questions in rounds, checks plan claims against code, gaps with verification criteria and examples, Next/Later/Never scope (read via WORKFLOW.md summary).
- https://github.com/gojko/lights-on-software-factory/blob/main/workspace/.claude/agents/workflow-worker.md : one step, own files only, test first, three attempts, answer schema with `deviation`, `blocker`, `decisionForLaterSteps`, `carryForwardDefect`; "A loud blocker with the task half done is better than a quiet guess that is finished."
- https://github.com/gojko/lights-on-software-factory/blob/main/workspace/.claude/agents/workflow-check.md : last agent tries to refute each step claim; `held`/`notHeld`/`notProvable`; "Evidence is a file, a line and a name."
- https://github.com/gojko/lights-on-software-factory/blob/main/REGULATOR.md : `PreToolUse` Bash regulator, per-role rules by `agent_type`, refusals say what to run instead; add a rule each time Claude asks for approval.
- https://github.com/gojko/lights-on-software-factory/blob/main/LINTER-HOOK.md : `PostToolUse` hook runs `eslint --fix` on edited files and blocks with the output; custom rules with RuleTester tests; add a rule each time you repeat review feedback.
- https://github.com/gojko/lights-on-software-factory/blob/main/workspace/.claude/workflow/README.md : plan notation, faults, `--lessons` content (blockers, deviations, defects, decisions, gate summaries, claims not held, what a person said).
- https://gojko.net/slides/202609-gotocph.pdf : GOTO Copenhagen 2026 slides linked from the repo README. Downloaded but not read (no extractable text with the tools available).
- https://training.techtalk.at/trainings/agentic-software-factory-workshop/ : Gojko's workshop page; contrasts with "a vibe-coding dark factory that nobody understands"; moving controls from the LLM into deterministic tools; claims 80% fewer tokens and 5 to 10 times faster workflows (unverified).
- https://news.ycombinator.com/item?id=47920020 : not Gojko. "Ask HN: What does your agentic software dark factory look like?"; one reply says review as a hard gate caused near-endless nitpick loops, another uses a separate agent to judge spec divergences and restart spec generation.

## Claude Code

- https://code.claude.com/docs/en/headless : `claude -p`; exit code 0 or non-zero; `--output-format text|json|stream-json`; `--json-schema` gives `structured_output` (check it exists); stream needs `--verbose`, last line is a `result` message; `system/init` first event; `system/api_retry` events; `--continue`, `--resume <id>`, session id from `.session_id`; `-p` runs project `.claude/settings.json` hooks unless `--bare`; `--bare` skips hooks, skills, CLAUDE.md; `--permission-prompts none`; `AskUserQuestion` removed in that mode; SIGTERM gives exit 143; slash skills work in `-p` prompts.
- https://code.claude.com/docs/en/cli-reference : flag rows for `--print`, `--output-format`, `--json-schema`, `--resume` (by id, name or `.jsonl` path), `--continue` (interactive `--continue` skips `-p` sessions; `-p --continue` includes them), `--session-id` (UUID), `--fork-session`, `--max-turns`, `--max-budget-usd`, `--permission-mode` values, `--no-session-persistence`, `--name`, `--append-system-prompt-file`, `--worktree`.
- https://code.claude.com/docs/en/hooks : Stop and SubagentStop: `decision: "block"` with `reason`, exit code 2 keeps Claude working, `continue: false` with `stopReason` ends processing, `last_assistant_message` input field, transcript may lag. Read in part (page is long).
- https://code.claude.com/docs/en/agent-sdk/typescript : `query({prompt, options})` with `resume`, `sessionId`, `forkSession`, `maxTurns`, `permissionMode`, `settingSources` (default all), `outputFormat: {type: 'json_schema'}`, `hooks`, `canUseTool`, `abortController`, `systemPrompt` preset with `append`. Result message section not read.
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents : initializer plus coding agent, JSON feature list where agents may only flip `passes`, progress file, one feature per session, commit per feature, run a basic end-to-end check at session start; failure modes: declaring victory early, marking done without testing.

## Codex

- https://learn.chatgpt.com/docs/non-interactive-mode (redirect from https://developers.openai.com/codex/noninteractive) : `codex exec`; progress on stderr, final message on stdout; `--json` JSONL events `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.*`, `error`; `--output-schema <file>`; `-o/--output-last-message`; `codex exec resume --last` or `<SESSION_ID>`; default sandbox read-only, `--sandbox workspace-write`; `--full-auto` no longer supported, `--approve-for-me` routes approvals to automatic review; `--ephemeral`; `--skip-git-repo-check`. No exit-code section.
- https://learn.chatgpt.com/docs/codex/cli : `codex resume` reopens a recent chat. No detail on whether `exec` sessions show in the interactive picker.
- https://codex.danielvaughan.com/2026/04/11/codex-cli-session-lifecycle-resume-fork-rollouts : third-party notes on resume, fork and rollout JSONL (not read in full; search summary only).

## OpenCode

- https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/cli.mdx : CLI docs. `opencode run [message..]` with `--continue/-c`, `--session/-s`, `--fork`, `--format default|json`, `--model`, `--agent`, `--file`, `--title`, `--attach`, `--dir`, `--auto`; TUI `opencode` with `--continue`, `--session`, `--prompt`; `opencode export [sessionID]`; `opencode session list --format json`; `opencode serve` and `attach`.
- https://opencode.ai/docs/cli/ : the published page (current version) says little about `run`; points to `--help`.

## Plan and task runners

- https://harper.blog/2025/02/16/my-llm-codegen-workflow-atm/ : origin of the brainstorm, spec, plan, todo flow. "Ask me one question at a time"; `spec.md`, `prompt_plan.md`, `todo.md`; executes prompts one by one, runs tests, decides to advance or debug; warns about getting "over my skis".
- https://github.com/github/spec-kit/blob/main/templates/commands/implement.md : spec-kit `/implement`: reads tasks.md, runs tasks in dependency order, "Report progress after each completed task", "Halt execution if any non-parallel task fails", marks `[X]`; optional before and after hooks from `.specify/extensions.yml`; asks before continuing when checklists are incomplete.
- https://kiro.dev/docs/specs/ : Kiro specs: requirements, design, tasks.md; run one task or all; "run all" groups tasks into waves; status shown in real time; review button for comments on docs.
- https://it20.info/2026/02/using-the-ralph-wiggum-loop-to-execute-kiro-specs/ : a post on driving Kiro specs with a Ralph loop (title only, not read).
- https://glama.ai/mcp/servers/eyaltoledano/claude-task-master/tools/next_task : Taskmaster `next` picks the next task whose dependencies are done (mirror, not project README).

## execa

- https://github.com/sindresorhus/execa : execa 10.2.1 (checked with `npm view`), Node `>=22`.
- https://github.com/sindresorhus/execa/blob/main/docs/lines.md : `for await (const line of execa\`...\`)` iterates stdout lines while the process runs; `.iterable({from: 'stderr'})`; the loop throws if the process fails.
- https://github.com/sindresorhus/execa/blob/main/docs/errors.md : rejects with `ExecaError` on non-zero exit; `reject: false` returns the result instead; `exitCode`, `failed`, `timedOut`, `isCanceled`, `isTerminated`, `shortMessage`.
- https://github.com/sindresorhus/execa/blob/main/docs/output.md : `stdout: 'inherit'` prints to the terminal; `stdio: 'inherit'` shortcut; array targets like `['inherit', {file}, 'pipe']`; warning: mixing `'inherit'` with other targets means the fd "will never refer to a TTY".
- https://github.com/sindresorhus/execa/blob/main/docs/input.md : `stdin: 'inherit'` for interactive input; `input` option to pass a string on stdin.
- https://github.com/sindresorhus/execa/blob/main/docs/termination.md : `cancelSignal` with an `AbortController` sends SIGTERM; `timeout`; `forceKillAfterDelay`.
