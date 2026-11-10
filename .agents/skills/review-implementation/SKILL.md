---
name: review-implementation
description: Review the code written for one plan step along two axes, Step (does it do what the step and the spec say?) and Standards (does it follow AGENTS.md and the local conventions?), in parallel fresh-context subagents. Use after a plan step is implemented and before it is marked done.
---

Two-axis review of the uncommitted changes in the working tree, for one step of `plan.md`:

- **Step**: does the change do what the step and the spec say, and only that?
- **Standards**: does the change follow `AGENTS.md` and the local conventions?

Neither subagent edits files.

## Process

### 1. Check the inputs

Confirm that `plan.md` has the step, that `spec.md` is in the same folder, and that `git diff` is not empty. Stop here if not.

### 2. Start both subagents in parallel

Start each with a fresh context. Give it the file paths, the step number, the diff command and its brief.

**Step brief**: "Report: (a) tests the step lists that are missing or check less than the step says; (b) tests that would pass without the change, unless the step says they protect existing behaviour; (c) new `if`, `else` or error paths that no test runs; (d) decisions on behaviour, public API, stored data or the work an operation does that the step and the spec leave open; (e) work added each time an existing operation runs, such as an extra database query, that the spec does not allow; (f) changes the step does not ask for. Quote the diff and the step or spec for each finding. Under 400 words."

**Standards brief**: "Report: (a) every place the diff breaks a rule in `AGENTS.md`; (b) every place it differs from the local conventions: the similar code and tests the step points to, and the code around the change, in naming, structure, error handling and test style; (c) overengineering: abstractions, options, helpers or layers the step does not need; (d) monkey-patching of globals, prototypes or third-party modules. Cite the rule or quote the existing code for each finding. Skip what the linter and the type checker already enforce. Under 400 words."

### 3. Report

Show the two reports under `## Step` and `## Standards`, without merging or reranking them. Tag each finding with where it belongs: `implementation` if the step and the spec are clear and the code does not follow them; `plan`, `spec` or `qa` if the code follows the step but the step is wrong, naming where the choice should have been made.

End with one line: `Status: approved` if there are no findings, otherwise `Status: changesRequested` with the number of findings per axis.

On `changesRequested`:

- Only `implementation` findings: the implementer fixes them, then this review runs again.
- Findings left after the second review, or any `plan`, `spec` or `qa` finding: ask the user whether to go back to `plan`, `specification` or `brainstorm`, with the findings as notes.

## Why two axes

Code can do exactly what the step asks and break the repo's rules, or follow every rule and do the wrong thing. Reporting them separately stops one from hiding the other.
