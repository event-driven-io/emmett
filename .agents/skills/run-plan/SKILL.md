---
name: run-plan
description: Run the unticked steps of a plan one by one, each in a fresh subagent with the implement-step skill. Use when the user asks to run a plan inside the current session.
---

# Run a plan in this session

The input is the path to `plan.md`. `todo.md` and `progress.md` are in the same folder.

You coordinate. You do not implement steps yourself, and you never pick a step other than the next one.

## For each step

1. Take the first unticked step in `todo.md`. If none is left, report that the plan is finished and stop. If the step has no matching step in `plan.md`, report the mismatch and stop.
2. Start a fresh subagent and tell it to run the `implement-step` skill for the plan file and the step number. Give it no other context.
3. Read its outcome. If the outcome is missing or not in the `implement-step` format, stop and show what it returned.
4. If the outcome is `notDone` or `blocker`, stop, show the details and ask the user what to do.
5. If the outcome is `planNeedsChange`, stop, show the details and ask the user whether to go back to the `brainstorm`, `specification` or `plan` skill, with the details as notes.
6. If the outcome is `done` or `doneWithDeviation`:
   - If the subagent reported `Review: notRun`, run the `review-implementation` skill in a fresh subagent and act on its status. The step's subagent is the implementer that fixes `implementation` findings.
   - Run the build and lint check that `AGENTS.md` names. If it fails, do not tick the step, stop and show the failure.
   - Otherwise tick the step in `todo.md`, show the summary and any deviation, and go on with the next step.

## Rules

- Do not commit and do not change Git history.
- Do not edit `plan.md` or `spec.md`. Only tick `todo.md`.
- Show a short line for each step when it starts and when it ends, with its outcome.
