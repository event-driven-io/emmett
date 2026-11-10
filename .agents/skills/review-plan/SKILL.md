---
name: review-plan
description: Review a plan along two axes, Spec (does it build what the spec says, and only that?) and Steps (can each step be built and tested on its own?), in parallel fresh-context subagents. Use after a plan is written or updated, or when the user asks for a plan review.
---

Two-axis review of `plan.md` against the `spec.md`, `qa.md` and `todo.md` in the same folder:

- **Spec**: does the plan build what the spec says, and only that?
- **Steps**: can each step be built and tested on its own?

Neither subagent edits files or proposes designs. They report problems and questions.

## Process

### 1. Check the inputs

Confirm that `plan.md`, `spec.md` and `todo.md` exist and are not empty. Stop here if not.

### 2. Start both subagents in parallel

Start each with a fresh context. Give it the file paths and its brief.

**Spec brief**: "Report: (a) acceptance criteria in the spec that no step lists, or that two steps list without saying which part each covers; (b) criteria a step reworded or that are not in the spec; (c) decisions in a step that the spec does not make; (d) work a step adds each time an existing operation runs, such as an extra database query, that the spec does not allow; (e) steps or criteria numbers that do not match between `plan.md`, `spec.md` and `todo.md`. Quote the plan and the spec for each finding. Under 400 words."

**Steps brief**: "Report: (a) criteria a step lists without a test that names the behaviour and what it asserts; (b) tests that would pass without the step's change, unless the step says they protect existing behaviour; (c) test names that describe the implementation instead of the behaviour; (d) edge cases, error paths and branches a step adds with no test; (e) behaviour a step adds that needs something only a later step creates, naming that step; (f) behaviour a step adds that nothing uses by the end of the step; (g) steps that ask for something `AGENTS.md` forbids; (h) steps whose What to build section lists code changes instead of behaviour; (i) steps with no pointer to the code they change or to similar code and tests to follow. Quote the plan for each finding. Under 400 words."

### 3. Report

Show the two reports under `## Spec` and `## Steps`, without merging or reranking them. Tag each finding with where it belongs: `plan` if the spec is clear and the plan does not follow it, `spec` if the spec lacks a decision the plan needs, `qa` if the Q&A never settled it.

End with one line: `Status: approved` if there are no findings, otherwise `Status: changesRequested` with the number of findings per axis.

On `changesRequested`, ask the user whether to go back: `brainstorm` for `qa`, `specification` for `spec`, `plan` for `plan` findings, with the findings as notes. Fix nothing yourself.

## Why two axes

A plan can cover every criterion with steps that cannot be tested on their own, or have clean, testable steps that build something the spec did not ask for. Reporting them separately stops one from hiding the other.
