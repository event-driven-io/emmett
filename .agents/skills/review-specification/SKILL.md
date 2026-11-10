---
name: review-specification
description: Review a spec along two axes, Q&A (does it follow what the user answered?) and Quality (can a developer build it without guessing?), in parallel fresh-context subagents, and save the findings as a review file. Use after a spec is written or updated, or when the user asks for a spec review.
---

Two-axis review of `spec.md` against the `qa.md` in the same folder:

- **Q&A**: does the spec say what the user answered, and only that?
- **Quality**: can a developer build it without making decisions the user did not make?

Neither subagent edits files or proposes designs. They report problems and questions. The user resolves each finding.

## Process

### 1. Check the inputs

Confirm that `spec.md` and `qa.md` exist and are not empty. Stop here if not. Read the revision at the top of `spec.md`. Find the earlier review files in the `reviews/` subfolder.

### 2. Start both subagents in parallel

Start each with a fresh context. Give it the file paths, the earlier review files, the diff of `spec.md` since the last reviewed revision, the shared rules and its brief.

**Shared rules**: "On a first review, go through every decision and every acceptance criterion in order, and apply every check to each. On a re-review, first check each finding resolved as `fixed` against the diff, then review the changed parts and what they affect. Read the existing code each decision depends on. Report a finding only when you can name its consequence: what a developer would build wrong, or what they would have to guess. Do not report wording or style, anything `qa.md` answers, or anything resolved in an earlier review. How a test sets something up, such as timings, lock durations or how two operations overlap, belongs to the plan. For each finding, give a title, the quotes, the consequence, and where it belongs. If there are none, write `No findings`. End with a `Checked:` line that lists what you went through."

**Q&A brief**: "Report: (a) answers in `qa.md` that the spec leaves out or contradicts; (b) answers that left options open but became a firm decision in the spec, with no later answer choosing; (c) notes marked still open that no later answer closed; (d) decisions in the spec that no answer and no existing code supports; (e) open items in the spec that the user did not mark as out of scope or follow-up. Quote the spec and the Q&A for each finding."

**Quality brief**: "Report: (a) places where the goal is unclear: you cannot say from the spec alone what problem it solves and what changes when it is done; (b) decisions where a developer would still have to choose between options, naming the options without recommending one; (c) work added each time an existing operation runs, such as an extra database query, with no answer in `qa.md` that allows it; (d) acceptance criteria without GIVEN, WHEN and THEN; (e) acceptance criteria without an observable result and concrete values; (f) acceptance criteria that would pass even if the feature were missing, unless they say they protect existing behaviour; (g) decisions with no acceptance criterion; (h) one thing with two names, or one name for two things. Quote the spec for each finding."

### 3. Save the review

Write both reports to `reviews/<timestamp>_spec_r<revision>_review.md`, with the timestamp as `YYYYMMDDTHHMMSS`, using the template below. Keep the two reports apart, without merging or reranking them. Tag each finding with where it belongs: `qa` if the Q&A never settled it, `spec` if the Q&A is clear and the spec does not follow it.

### 4. Ask the user

Show the review file. The user resolves each finding as `fixed` (the spec changes), `accepted` (a known shortcoming that stays) or `rejected` (not an issue). Write each resolution into the file in the user's words. For `qa` findings, ask whether to go back to `brainstorm`. Fix nothing before the user resolves it. The user approves the review.

<review-template>

# Review: spec r<revision>

Reviewed: `spec.md` r<revision>, `qa.md` up to <last question>. Earlier reviews: <file names, or "None">.

## Q&A

Checked: <what the subagent went through>

### Q&A-<n>. <title>

Quote: <spec and Q&A quotes>
Consequence: <what a developer would build wrong or have to guess>
Belongs to: qa | spec
Resolution: <filled in from the user: fixed in r<n> | accepted: <reason> | rejected: <reason>>

## Quality

Checked: <what the subagent went through>

### Quality-<n>. <title>

Quote: <spec quotes>
Consequence: <what a developer would build wrong or have to guess>
Belongs to: qa | spec
Resolution: <filled in from the user>

</review-template>

## Why two axes

A spec can follow every answer and still leave a developer guessing, or be precise and still say things the user never decided. Reporting them separately stops one from hiding the other.
