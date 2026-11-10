---
name: review-implementation
description: Review the code written for one plan step along two axes, Step (does it do what the step and the spec say?) and Standards (does it follow AGENTS.md and the local conventions?), in parallel fresh-context subagents, and save the findings as a review file. Use after a plan step is implemented and before it is marked done.
---

Two-axis review of the uncommitted changes in the working tree, for one step of `plan.md`:

- **Step**: does the change do what the step and the spec say, and only that?
- **Standards**: does the change follow `AGENTS.md` and the local conventions?

Neither subagent edits files.

## Process

### 1. Check the inputs

Confirm that `plan.md` has the step, that `spec.md` is in the same folder, and that `git diff` is not empty. Stop here if not. Find the earlier review files for this step in the `reviews/` subfolder.

### 2. Start both subagents in parallel

Start each with a fresh context. Give it the file paths, the step number, the diff command, the earlier review files for this step, the shared rules and its brief.

**Shared rules**: "On a first review, go through every changed file and every test the step lists, and apply every check to each. On a re-review, first check each earlier finding against the diff, then review what changed since and what it affects. Report a finding only when you can name its consequence: a wrong behaviour, a missed case, or a rule broken. Do not report wording or style, or anything resolved in an earlier review. For each finding, give a title, the quotes, the consequence, and where it belongs. If there are none, write `No findings`. End with a `Checked:` line that lists what you went through."

**Step brief**: "Report: (a) tests the step lists that are missing or check less than the step says; (b) tests that would pass without the change, unless the step says they protect existing behaviour; (c) new `if`, `else` or error paths that no test runs; (d) decisions on behaviour, public API, stored data or the work an operation does that the step and the spec leave open; (e) work added each time an existing operation runs, such as an extra database query, that the spec does not allow; (f) changes the step does not ask for. Quote the diff and the step or spec for each finding."

**Standards brief**: "Report: (a) every place the diff breaks a rule in `AGENTS.md`; (b) every place it differs from the local conventions: the similar code and tests the step points to, and the code around the change, in naming, structure, error handling and test style; (c) overengineering: abstractions, options, helpers or layers the step does not need; (d) monkey-patching of globals, prototypes or third-party modules. Cite the rule or quote the existing code for each finding. Skip what the linter and the type checker already enforce."

### 3. Save the review

Write both reports to `reviews/<timestamp>_step<n>_review.md`, with the timestamp as `YYYYMMDDTHHMMSS`, using the template below. Keep the two reports apart, without merging or reranking them. Tag each finding with where it belongs: `implementation` if the step and the spec are clear and the code does not follow them; `plan`, `spec` or `qa` if the code follows the step but the step is wrong, naming where the choice should have been made.

### 4. Act on the findings

End with one line: `Review: clean` if there are no findings, `Review: blocked` if any finding belongs to `plan`, `spec` or `qa`, otherwise `Review: findingsLeft`.

- `implementation` findings: the implementer fixes them, then this review runs again once. Findings still left after that second review get `Resolution: open` and wait for the user at the end of the plan run.
- `plan`, `spec` or `qa` findings block the step: ask the user whether to go back to `plan`, `specification` or `brainstorm`, with the findings as notes.

<review-template>

# Review: step <n>

Reviewed: the working tree diff for step <n> of `plan.md` r<revision>. Earlier reviews of this step: <file names, or "None">.

## Step

Checked: <what the subagent went through>

### Step-<n>. <title>

Quote: <diff and step or spec quotes>
Consequence: <the wrong behaviour, missed case or broken rule>
Belongs to: implementation | plan | spec | qa
Resolution: <fixed | open | from the user: accepted: <reason> | rejected: <reason>>

## Standards

Checked: <what the subagent went through>

### Standards-<n>. <title>

Quote: <diff and rule or existing code>
Consequence: <the wrong behaviour, missed case or broken rule>
Belongs to: implementation | plan | spec | qa
Resolution: <fixed | open | from the user>

</review-template>

## Why two axes

Code can do exactly what the step asks and break the repo's rules, or follow every rule and do the wrong thing. Reporting them separately stops one from hiding the other.
