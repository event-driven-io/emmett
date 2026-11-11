---
name: review-plan
description: Review a plan along two axes, Spec (does it build what the spec says, and only that?) and Steps (can each step be built and tested on its own?), in parallel fresh-context subagents, and save the findings as a review file. Use after a plan is written or updated, or when the user asks for a plan review.
---

Two-axis review of `plan.md` against the `spec.md`, `qa.md` and `todo.md` in the same folder:

- **Spec**: does the plan build what the spec says, and only that?
- **Steps**: can each step be built and tested on its own?

Neither subagent edits files or proposes designs. They report problems and questions. The user resolves each finding.

## Process

### 1. Check the inputs

Confirm that `plan.md`, `spec.md` and `todo.md` exist and are not empty. Stop here if not. Read the revisions at the top of `plan.md` and `spec.md`. Find the earlier review files in the `reviews/` subfolder.

### 2. Start both subagents in parallel

Start each with a fresh context. Give it the file paths, the earlier review files, the diff of `plan.md` since the last reviewed revision, the shared rules and its brief.

**Shared rules**: "On a first review, go through every step in order, and apply every check to each. On a re-review, first check each finding resolved as `fixed` against the diff, then review the changed steps and what they affect. Read the existing code each step points to. Report a finding only when you can name its consequence: what the implementer would build wrong, or what they would have to guess. Do not report wording or style, anything `qa.md` answers, or anything resolved in an earlier review. For each finding, give a title, the quotes, the consequence, and where it belongs. Report only what needs a decision from the user, or what would make the implementer build or test something wrong. A slip the coordinator can fix without a decision, such as a step missing from Blocked by, a test name that differs from the code, or a version range where the exact version is known, is not a finding: list it in one line under `Mechanical:` instead. If there are none, write `No findings`. End with a `Checked:` line that lists what you went through."

**Spec brief**: "Report: (a) acceptance criteria in the spec that no step lists, or that two steps list without saying which part each covers; (b) criteria a step reworded or that are not in the spec; (c) decisions in a step that the spec does not make; (d) work a step adds each time an existing operation runs, such as an extra database query, that the spec does not allow; (e) steps or criteria numbers that do not match between `plan.md`, `spec.md` and `todo.md`; (f) a plan built from an older spec revision than the current `spec.md`. Quote the plan and the spec for each finding."

**Steps brief**: "Report: (a) criteria a step lists without a test that names the behaviour and what it asserts; (b) tests that would pass without the step's change, unless the step says they protect existing behaviour; (c) test names that describe the implementation instead of the behaviour; (d) edge cases, error paths and branches a step adds with no test; (e) behaviour a step adds that needs something only a later step creates, naming that step; (f) behaviour a step adds that nothing uses by the end of the step; (g) steps that ask for something `AGENTS.md` forbids; (h) steps whose What to build section lists code changes instead of behaviour; (i) steps with no pointer to the code they change or to similar code and tests to follow; (j) tests that do not say their setup: values, timings, and how concurrent operations are made to overlap; (k) steps that cannot be merged and deployed on their own, because an existing test fails or product code does not use what the step adds until a later step; steps that split a criteria group, or split a behaviour into its function, its wiring and its tests; steps that change more than one area (such as one event store, one migration or one public API) where each part could be merged on its own; (l) existing tests a step breaks without saying how it updates them. Quote the plan for each finding."

### 3. Save the review

Write both reports to `reviews/<timestamp>_plan_r<revision>_review.md`, with the timestamp as `YYYYMMDDTHHMMSS`, using the template below. Keep the two reports apart, without merging or reranking them. Tag each finding with where it belongs: `plan` if the spec is clear and the plan does not follow it, `spec` if the spec lacks a decision the plan needs, `qa` if the Q&A never settled it.

### 4. Ask the user

Fix the `Mechanical:` items in the plan without asking, and name them in one line. Show the review file. The user resolves each finding as `fixed` (the plan, spec or Q&A changes), `accepted` (a known shortcoming that stays) or `rejected` (not an issue). Write each resolution into the file in the user's words. For `qa` and `spec` findings, ask whether to go back to `brainstorm` or `specification`. Fix nothing before the user resolves it. The user approves the review.

<review-template>

# Review: plan r<revision>

Reviewed: `plan.md` r<revision>, built from spec r<n>; `spec.md` r<revision>. Earlier reviews: <file names, or "None">.

## Spec

Checked: <what the subagent went through>

### Spec-<n>. <title>

Quote: <plan and spec quotes>
Consequence: <what the implementer would build wrong or have to guess>
Belongs to: plan | spec | qa
Resolution: <filled in from the user: fixed in r<n> | accepted: <reason> | rejected: <reason>>

## Steps

Checked: <what the subagent went through>

### Steps-<n>. <title>

Quote: <plan quotes>
Consequence: <what the implementer would build wrong or have to guess>
Belongs to: plan | spec | qa
Resolution: <filled in from the user>

</review-template>

## Why two axes

A plan can cover every criterion with steps that cannot be tested on their own, or have clean, testable steps that build something the spec did not ask for. Reporting them separately stops one from hiding the other.
