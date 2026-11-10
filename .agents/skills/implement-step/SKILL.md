---
name: implement-step
description: Implement one step of a plan test-first and end with an outcome in a fixed format. Use when the user asks to implement a plan step, or when a plan loop runs a step.
---

# Implement one plan step

The input is the path to `plan.md` and the step number. `spec.md`, `todo.md` and `progress.md` are in the same folder.

You decide how the code is written. The spec decides behaviour, public API, stored data and the work each operation does. When the step and the spec leave one of those open, ask.

## Before you write code

1. Read `AGENTS.md`, the parts of the plan before the steps, and the step's prompt. If the step number does not exist in the plan, stop with `blocker`.
2. Read `progress.md`. If an earlier attempt at this step left notes, continue from them.
3. Check the step against the spec and the current code. Stop and ask instead of following the step when:
   - the step needs a decision that is not yours and that the step and the spec do not make;
   - the step adds work each time an existing operation runs, such as an extra database query, and the spec does not allow it;
   - the step prescribes a branch that no test in this step can reach;
   - the step prescribes a hack or monkey-patching;
   - the step contradicts the spec or the code.

   Use `planNeedsChange` when the plan or the spec must change, and `blocker` when something outside the step stops it. Put the question in the details.

## While you implement

- Work test-first: write the failing test, run it, see it fail for the expected reason, make it pass, then refactor.
- A step is a full red-green cycle. Tests are green when it ends.
- Run the smallest relevant tests while you work, then the checks that `AGENTS.md` requires before a step is complete. Build and lint must never be broken.
- Do not commit, do not tick `todo.md`, and do not edit `plan.md` or `spec.md`.

## After you implement

1. Run the `review-implementation` skill in a subagent with a fresh context and act on its status. Where it says to ask the user, stop with `planNeedsChange` and put the findings in the details. If you run as a subagent and cannot start another one, skip the review and report `Review: notRun`, so that the caller runs it.
2. Write to `progress.md`, under a heading for the step: a short summary on success, or on failure a longer write-up with what you tried, what failed, what is left and what decision is needed.
3. Return the outcome.

## Outcome

End with the outcome in this format:

```text
Outcome: done | doneWithDeviation | notDone | blocker | planNeedsChange
Review: approved | changesRequested | notRun
Summary: <one or two sentences>
Details: <required for every outcome except done>
Checks: <each command you ran and whether it passed>
```

- `done`: the step is finished as written.
- `doneWithDeviation`: finished, with an implementation-level deviation from the prompt, described in the details.
- `notDone`: not finished, for example because of a failing test you could not fix.
- `blocker`: something outside the step stops it, for example a missing prerequisite.
- `planNeedsChange`: the step can only be done by changing the plan, the spec or the Q&A.
