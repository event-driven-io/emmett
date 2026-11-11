# Q&A: agentic loop that executes a plan

Idea (verbatim): Having plan like in brainstorms/numeric-schema-version/plan.md and todo like in brainstorms/numeric-schema-version/todo.md could you design an agentic loop (do research) that'd go through the plan following the agents.md guidelines and giving a clear feedback on the result, stoping if found issues, and param to stop for the review by human when needed? If there's error it should by param either try to ask agent to troubleshoot or open interactive claude session with user. If there's a divergance needed from plan it should stop and ask user if should get back to qa and work on the spec. The input sould be plan file

## Q1. Research: now or later, and what scope?

Question: Should I start the research now, before more questions, and what should it cover? Proposed survey: existing loop patterns for coding agents (Ralph loop, Claude Code headless `claude -p`, `--resume`, stream-json, Claude Agent SDK, Codex `exec`, OpenCode run mode, community plan/todo runners), and how they pause for a human, hand over to an interactive session, and report structured results.

Answer (verbatim): yes, do a basic research, it'd be good if it could also work with codex and open code, but for not claude is priority, check ralph wiggum loop, gojko, matt pockock and other options, but I don't want slop dark factory, but something that plays well with my skills like brainstorm, specification, plan etc. and being a proper engineer

## Note added by Oskar after Q2 was asked (before answering it)

Answer (verbatim): Ah, and not overengineer, simple, maybe using execa to make easier and smoother code. Also claude/codex etc. should be giving a clear progress, later we also want to have review and other extnesibility

## Q2. What should the result of a step tell, and when and where to read it?

Question: When a step finishes, what should its result tell you (for example which acceptance criteria passed, which commands ran and their output, which files changed, open doubts)? When do you want to read it: after every step, only when the loop stops, or once at the end? Where should it live: only in the terminal, or also in a file next to `todo.md`?

Answer (verbatim): i want to start simple, but without hacking, simple but solid foundations fitting my process, and extend it piece by piece

## Q3. Is a terminal result enough in the first version, or also a file?

Question: In the first version, when a step ends, is it enough that the loop prints the result in the terminal? Or must the result also be saved in a file, so you can read it later or another tool can pick it up? If you want a file, should it be one file per step or one file for the whole run?

Answer (verbatim): Definitly I should get a clear information like log, it'd be good if it was observable (using almanac), eventually dogfooding emmett with worfklows. I think that both file and output

Follow-up from Oskar (verbatim): It need to be observable

## Q4. Where to look at what happened: local output, an OpenTelemetry backend, or both?

Question: In the first version, where do you want to look at what happened? Local only (Almanac console or pino output plus the run file), or OpenTelemetry to a backend you run (Jaeger, Grafana, Aspire), where each step is a span with the agent and verification commands nested inside? If a backend, which one do you use today?

Answer (verbatim): maybe both, almanac gives such option, right?

Checked in code: yes. `compositeTracer(...tracers)` in `src/packages/almanac/src/tracers/compositeTracer.ts` runs several tracers at once, and Almanac has console, pino and OpenTelemetry providers in `src/packages/almanac/src/providers/`.

## Q5. Where does the run file live, and in what shape?

Question: Where should the run's file live, and how should it be laid out? Next to the plan (for example `brainstorms/numeric-schema-version/runs/...`) or in a git-ignored folder? One file per run or one per step? Readable Markdown, or JSON lines a tool can parse (pino gives that for free)?

Answer (verbatim): runs folder is probably fine, but I'm not sure if we need it, if it can't be a single file near todo. Probably makrdown but open also for others

## Q6. After a stop and a later start: one continuous log, or a record per run?

Question: Suppose the loop stops at step 5 (an issue or a review pause), and you start it again later. Should the restart add to the same log as one continuous story of the plan, or should each start get its own record, so you can see run 1 stopped at step 5 and run 2 picked up from there?

Answer (verbatim): Yes, start should be idempotent and continue, but we should have setting to restart

## Q7. What should the restart setting do?

Question: Run the plan from step 1 again (even ticked steps)? Redo only the step that stopped, and then keep or throw away its half-done changes in the working tree? Start a fresh log and keep the earlier one?

Answer (verbatim): Resume should check in progress and continue, restart should restart

## Q8. What does restart cover, and what about code earlier steps changed?

Question: When you restart, is it the whole plan from step 1 (untick `todo.md`, fresh log) or only the current step? What about the code earlier steps already changed? The loop can't undo it without touching git, which AGENTS.md forbids unless asked. Is restart only for after you reset the working tree yourself, or should it run on top of existing changes?

Answer (verbatim): For now let's untick and start, but some follow up for laer, and yes get research text from agent and write findings

Follow-up for later: what restart does with code that earlier steps already changed.

## Q9. Where do review points come from, and how does the loop go on after a review?

Question: Where do the review points come from: set per run (every step, or after chosen steps such as `--review-after 3,8`), marked in the plan (a "Review: yes" line in a step), or both? When the loop stops for review, what do you do to let it go on: run the same command again, or answer a prompt in the terminal it waits on?

Answer (verbatim): also it seems that the agent didn't do a proper job, as gojko adzic has lights on fatory sample. If I'm doing review, then I'll pass feedback what to improve for the claude/codex (i mentioned interactive) or if it's findings then it should ask and potentially go through the flow qa=>spec refinement=>plan refinement => implementation

Still open from Q9: where review points come from (per run, in the plan, or both).

## Q10. Where do review points come from?

Question: Do you set them when you start a run (for example "every step" or "after steps 3 and 8")? Does the plan mark them in the step itself? Or both?

Answer (verbatim): could be both

## Q11. External script with a fresh agent per step, or a loop inside one agent session?

Question: A separate process that drives one fresh headless agent run per step (Huntley, Pocock, Gojko; also works with Codex and OpenCode), or a skill/command inside one Claude session that walks the plan (spec-kit `/implement`, Ralph plugin), or another shape?

Answer (verbatim): I want definitely to have fresh context on each task, but open to both

## Q12. Who marks a step done in `todo.md`, and after which checks?

Question: Should the agent that did the step tick it, or the loop after it has run the checks itself? If the loop, which checks must pass first (`agent:check`, `test:unit`, the test files the step names)?

Answer (verbatim): I think that both, agent passes the result, but look can do defined additional steps so e.g. tests, this should be composable in the workflow setup by passing steps. In the first version at least the agent feedback (it'll run agent:check through hook)

## Q13. Which outcomes must the agent be able to report in the first version?

Question: Candidates: Gojko's `done`, `doneWithDeviation`, `notDone`, `blocker`, plus from earlier answers "found issues", "error", "the plan needs to change". Which are separate outcomes with different loop behaviour, and which are the same?

Answer (verbatim): The one you mention sounds fine to me. Agent should also be keeping the progress in Md

## Q14. What does the agent write in its own Markdown progress, and where?

Question: Apart from the loop's log, what should the agent write in its Markdown progress (for example what it tried, decided, what is left, so a fresh-context agent can continue an interrupted step)? One file per plan next to `todo.md`, or one section per step in a shared file?

Answer (verbatim): Definitely the short summary, and longer it failed. We should have definitely skill for implementing step so it's formalised

Still open from Q14: where the agent's progress lives (one file per plan or a section per step).

## Q15. Does the step skill also work on its own, and what does it own?

Question: Should the step skill also work by hand in a normal interactive session (`/implement-step <plan> 3`), or only for the loop? What must it own (reading the step from the plan, working test-first per AGENTS.md, writing the progress summary, returning the outcome in a fixed format)?

Answer (verbatim): yes, definitely, we can also have skill for agent loop you mentioned, this could be useful for simpler passes

## Q16. How does agent troubleshooting work, and what counts as an error?

Question: When the setting says "let an agent troubleshoot", should the troubleshooting agent resume the failed step's session or start fresh with the failure write-up? How many attempts before handing over or stopping? What counts as an "error" (a crash or failed check, as opposed to `notDone` or a blocker)?

Answer (verbatim): we can have both modes configurable, by default, as said, I'd get back with interactive mode and ask user whether to continue with qa or research, implementation agent shouln't made decisions that are not implementation decisions in the scope of task

Still open from Q16: number of troubleshooting attempts, and what counts as an "error".

## Q17. How does the loop carry on after "back to Q&A"?

Question: Does the loop end so you run brainstorm, specification and plan yourself and restart it, or does it open those skills for you in an interactive session and resume on its own? If steps were renumbered or rewritten, how should the loop treat steps already ticked?

Answer (verbatim): It should just get back to the interactive ask whether to call qa skill, then carry normally, I said it already, ticked unless changed should be treated as done and continue with first not done

## Q18. Where should the loop's code live?

Question: In `.agents/` next to the hooks as a TypeScript script run from `src` (execa the first dependency there), as its own package under `src/packages/` (closer to later dogfooding Emmett workflows and Almanac), or somewhere else?

Answer (verbatim): definitely I'd like to make it reusable, but I'd like to start simple, then expand, so keeping it open for more extensions

## Q19. Reusable where?

Question: Within Emmett only, or across your other repos (Pongo, Dumbo) as an npm package? If the latter, should the first version already be a package, or start in `.agents/` and move out once it works?

Answer (verbatim): In my other projects, dude, the skills I have are generic, this should also be generic, but for now by easily copy/pasting, then if it grows a cli or whatever

## Q20. Which agents does the first version drive?

Question: Claude Code only, with Codex and OpenCode added later as separate pieces, or must one of them work from day one?

Answer (verbatim): claude first

Follow-up from Oskar on Q20 (verbatim): but we need to be already prepared to add more

## Q21. What happens after you exit the interactive review session?

Question: Should the loop ask you in the terminal (continue to the next step, run the step's checks again, or stop), or just go on to the next step?

Answer (verbatim): it depends on the outcome of discussion

## Q22. How does the loop learn the outcome of the review discussion?

Question: Should the agent write the outcome in the step skill's fixed format before you exit and the loop read it, or should the loop ask you in the terminal after you exit, or both with one as a fallback?

Answer (verbatim): man, could we start with a scenario that's extensible but simple and continue such deep discussions after we have something working?

## Q23. Ready for the spec?

Question: Gaps get the simplest extensible default, marked to revisit later: after an interactive session the loop asks in the terminal; troubleshooting attempts capped by a setting; agent progress in one Markdown file per plan next to `todo.md`; "error" means a crash or a failed check, while `notDone` and blocker are reported outcomes. Shall I write the spec now?

Answer (verbatim): Yes, please do

## Q24. Go back to Q&A for two items the specification found missing?

Question: The specification skill found two things missed in Q&A: (1) the permission mode for the headless run, since `claude -p` denies tool calls that need approval; (2) `stop_hook_active` on a resumed session, since the hook skips `agent:check` on the second stop in a chain. Would you like to go back to Q&A for these two?

Answer (verbatim): yes

## Q25. What may a headless step agent do without asking?

Question: Project settings allow only `npm run build:ts:*`, `npm run test:file:*` and one WebFetch domain, so a headless step agent without a permission mode could not edit files or run tests. Options: `acceptEdits` plus a command allow-list in the loop's settings; rely on the repo's Claude settings; a wider mode such as `auto` or `bypassPermissions`; or another approach?

Answer (verbatim): for now start with auto and bypass permissions, but make a note in spec to investigate that further in the next steps

## Q26. Which permission mode is the default?

Question: Claude takes one permission mode per run. `auto` as default with a setting for `bypassPermissions`, the reverse, or a free setting with no fixed default?

Answer (verbatim): I mean, the one that won't cause agent to stop on some basic permission issues

## Q27. How does the loop guard against `stop_hook_active` skipping the re-check?

Question: When the first `agent:check` fails, the hook blocks, the agent fixes and stops again with `stop_hook_active` set, and the hook skips the check, so a headless run can end unverified and still report `done`. Should the loop always run `agent:check` itself after the agent ends (built in, before extra checks), leave it to the extra-checks setting, or change the hook to re-check while the marker is still there (which changes interactive sessions too)?

Answer (verbatim): plan should explicitly state whether tests are expected to be broken, build and linter should never be broken.

## Q28. Built-in `agent:check`, and tests allowed to be broken only when the plan says so?

Question: Interpretation: the loop always runs `agent:check` itself after every step (build and lint never broken; failure is an error, no tick), which closes the `stop_hook_active` gap without changing the hook. Tests stay green by default; a step that may leave tests red says so with an explicit mark in the plan, and the plan skill gets a note on it. Configured test checks must pass unless the step has that mark; then the loop runs them, logs failures, and does not treat them as an error. Is that right, and with the mark, should the loop still run and log the tests or skip them?

Answer (verbatim): yes, still plan should avoid such cases, only when it's needed to make progress smoother and only for short time

## Q29. Ready to update the spec?

Question: Both open items are settled (built-in `agent:check` after every step, tests green unless the step is explicitly marked, the plan skill notes to avoid the mark, `bypassPermissions` by default with a note to investigate). Shall I update the spec?

Answer (verbatim): Typically step should be a full red-green cycle, now specification could be runnable also by you i think

## Context for Q30 onwards: why step 8 of numeric-schema-version added a per-call catalog lookup

Oskar asked (verbatim): "analyse why you did such bs change and tell me why agent didn't stop and ask before making such stupid change. Is it about order and not grouping steps correctly, or lack of the info to stop and ask in such case? What should we improve in this spec/plan, and also .agents/skills/specification/SKILL.md and .agents/skills/plan/SKILL.md in general?"

Analysis given: (1) the spec required "both functions insert into a column of either type" without saying when the type is known, and has no performance constraint; (2) the plan invented "detect the column type once per call from the catalog", which Q&A never decided; (3) the conversion was split from the steps that create an `INT` column (10, 11), so step 8 prepared for a state that did not exist yet and its `INT` branch had no test; (4) the step rules only stop when a step "cannot be done as written", so a feasible but bad prescription was followed.

## Q30. Where should hot-path knowledge live so every stage sees it?

Question: In the project's AGENTS.md as a standing constraint, in each spec as a constraints section that brainstorm must ask about, or both?

Answer (verbatim): 1. Yes, that I don't understand how on earth agent could interpret it this way.
2. How caan we detect that?
3. Ok, how can we improve plan procedure to avoid such artificial split?
4. How can we improve the plan procedure? Maybe some forma t or reviewer for plan and implementation?

Q30-man we can't predict everything. Agent should ask about it or had some hints on the direction, but we can't overspecify all precise things to look on as there will be always some left.

Answers given to Oskar's points 1–4 before Q31: (1) the agent read "either type" as "unknown at call time" and optimised for one shared body, checking correctness only, not cost or decision ownership; (2) detect by tracing: every concrete technical choice in a plan step must point to the spec or a Q&A answer, otherwise it is an invented decision and becomes a question; (3) a step may only add behaviour its own tests can exercise, so code waiting for a later state moves to the step that creates that state; (4) a per-step "Decisions" list with sources, a fresh-context plan reviewer, and a step-agent pre-flight that stops on feasible-but-doubtful prescriptions.

## Q31. May the plan reviewer fix the plan, or only report?

Question: Should the plan reviewer only report findings and stop with questions, or may it also fix things that clearly trace back to the spec and ask only about invented decisions?

Answer (verbatim): Reviewer should just review and ask to get back to qa or fixing the spec or plan (depending where the issue lives), so calling brainstorm or specification or plan skill to adjust with additional notes

## Q32. When does the plan review run?

Question: Automatically as the plan skill's last step in a fresh-context subagent, as its own skill (`/review-plan`) called by hand, or both?

Answer (verbatim): Automatically, as the plan skill's last step in a fresh-context subagent, before the plan reaches you - yes, and I should be able to coll it. In general each time plan is updated review should come up. We should also have review specification skill accordingly.

## Q33. What does the specification reviewer look for?

Question: Trace spec decisions to Q&A; statements that hide an unmade decision (like "either column type" without saying when the type is known); missing direction such as performance-sensitive paths; anything else?

Answer (verbatim): shouldn' plan trace to spec and spec to qa and specification reviewer should go through qa and double-check if some questions were not ignored or handwaved and if spec doesn't have any open items that were not explicitly put into follow up or out of scope. Also it should ensure the goal is clear, acceptance criteria are clear and not strawman. Yes, it can double check consistency and performance sensitive or dangerous steps that weren't clearly approved.

## Q34. Implementation side: a pre-check before coding, a fresh-context review after, or both?

Question: Should a fresh-context reviewer check each finished step (diff against the step and the spec; per-call cost, untestable branches, hacks, decisions the plan did not make) before it is ticked, or is it enough that the step agent stops before coding when a prescription looks doubtful, or both?

Answer (verbatim): What do you mean by  Should a fresh-context reviewer also check each finished step before it's ticked? Definitely implementation should check before implementation if plan is right, then implementation reviewer should double check in fresh context afterwards

## Q35. What happens when the implementation reviewer finds an issue?

Question: Code-level issues go back to the step agent and plan/spec/Q&A issues stop and ask (as with the plan reviewer), or every finding stops and asks?

Answer (verbatim): When it finds issue, if it's clearyly implementation issue then it should tell the implementation agent what to fix, but if it's plan or spec issue it should follow the regular path gettin back to user, so it should return a clear status for review and steps in a certain format

## Q36. Which statuses does a review return?

Question: One shared format for all three reviewers (`approved`, `fixImplementation` with fixes, `needsChange` with the layer and notes), or a separate set per reviewer?

Answer (verbatim): Dude, don't go crazy start with simple stuff, then we can enhance, start with basic set that are consistent

## Q37. Is the review status set right, and should the plan-execution-loop spec be updated with all of this?

Question: Two statuses (`approved`, `changesRequested` with findings tagged implementation, plan, spec or Q&A), routing as above, the step agent's pre-coding check reusing `planNeedsChange` or `blocker`, skill changes, and new `review-specification` and `review-plan` skills, all written into `plan-execution-loop/spec.md`?

Answer (verbatim): Did I ask that it should be the part of this spec? It can be, but for now, I'd like to fix what we have and then implement fool loop to be able to finish numeric schema correctly

## Q38. What counts as "what we have"?

Question: The skills (specification, plan, new review skills), the numeric-schema-version spec and plan run through the fixed process, the plan-execution-loop spec, or a mix, and in what order?

Answer (verbatim): Dude, what we have atm in repo, I want to add skills that we discussed and adjust skills I mentioned

## Note added by Oskar while the skills were being written

Answer (verbatim): We should also add implementation skill and skill with loop we discusssed

## Q39. Step 8 of numeric-schema-version stopped with `planNeedsChange`: the review tagged as `plan` a case that spec Helpers and "Out of scope" already decide, and implement-step passed it on unchecked and later skipped the second review. Should review-implementation and implement-step check `spec.md` and `qa.md` before treating a finding as a plan gap, and implement-step re-run the review after fixes?

Answer (verbatim): Man, we were discussing that, we have poc, what's wrong?

Answer (verbatim): We should enhance also review skill and implementation right?

Answer (verbatim): ok
