---
name: review-specification
description: Review a spec along two axes, Q&A (does it follow what the user answered?) and Quality (can a developer build it without guessing?), in parallel fresh-context subagents. Use after a spec is written or updated, or when the user asks for a spec review.
---

Two-axis review of `spec.md` against the `qa.md` in the same folder:

- **Q&A**: does the spec say what the user answered, and only that?
- **Quality**: can a developer build it without making decisions the user did not make?

Neither subagent edits files or proposes designs. They report problems and questions.

## Process

### 1. Check the inputs

Confirm that `spec.md` and `qa.md` exist and are not empty. Stop here if not.

### 2. Start both subagents in parallel

Start each with a fresh context. Give it the two file paths and its brief.

**Q&A brief**: "Report: (a) answers in `qa.md` that the spec leaves out or contradicts; (b) answers that left options open but became a firm decision in the spec, with no later answer choosing; (c) notes marked still open that no later answer closed; (d) decisions in the spec that no answer and no existing code supports; (e) open items in the spec that the user did not mark as out of scope or follow-up. Quote the spec and the Q&A for each finding. Under 400 words."

**Quality brief**: "Report: (a) places where the goal is unclear: you cannot say from the spec alone what problem it solves and what changes when it is done; (b) decisions where a developer would still have to choose between options, naming the options without recommending one; (c) work added each time an existing operation runs, such as an extra database query, with no answer in `qa.md` that allows it; (d) acceptance criteria without GIVEN, WHEN and THEN; (e) acceptance criteria without an observable result and concrete values; (f) acceptance criteria that would pass even if the feature were missing; (g) decisions with no acceptance criterion; (h) one thing with two names, or one name for two things. Quote the spec for each finding. Under 400 words."

### 3. Report

Show the two reports under `## Q&A` and `## Quality`, without merging or reranking them. Tag each finding with where it belongs: `qa` if the Q&A never settled it, `spec` if the Q&A is clear and the spec does not follow it.

End with one line: `Status: approved` if there are no findings, otherwise `Status: changesRequested` with the number of findings per axis.

On `changesRequested`, ask the user whether to go back: `brainstorm` for `qa` findings, `specification` for `spec` findings, with the findings as notes. Fix nothing yourself.

## Why two axes

A spec can follow every answer and still leave a developer guessing, or be precise and still say things the user never decided. Reporting them separately stops one from hiding the other.
