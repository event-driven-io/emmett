---
name: plan
description: Turn a spec into a detailed plan. Use when the user wants to refine an idea before implementation.
disable-model-invocation: true
---

The spec is in the file called: $ARGUMENTS

1. Draft a detailed, step-by-step blueprint for building the provided specification. Then, once you have a solid plan, break it down into small, iterative chunks that build on each other. Look at these chunks and then go another round to break it into small steps. Review the results and make sure that the steps are small enough to be implemented safely with strong testing, but big enough to move the project forward. Iterate until you feel that the steps are right sized for this project. Don't create artificial phases or steps if they don't bring much value.

2. Build the plan in a way prioritising features and quick wins and being able to deliver safe improvement that could be pushed and merged. Follow make the change easy, make the easy change.

3. From here you should have the foundation to provide a series of prompts for a code-generation LLM that will implement each step in a test-driven manner. Prioritize best practices, incremental progress, and early testing, ensuring no big jumps in complexity at any stage. Make sure that each prompt builds on the previous prompts, and ends with wiring things together. There should be no hanging or orphaned code that isn't integrated into a previous step.

4. Each prompt should be self contained, with the acceptance criteria from spec about features and scenarios. It should be actionable and don't require research or PoC.

5. Make sure and separate each prompt section. Use markdown. Each prompt should be tagged as text using code tags. The goal is to output prompts, but context, etc is important as well.

6. Each prompt copies the acceptance criteria it implements from the spec, with their numbers and without rewording.

7. Each criterion maps to at least one test, named after the observable behaviour, with what the test asserts.

8. Each prompt also lists tests for the edge cases, error paths and branches that the criteria do not cover.

9. A prompt points to the existing code the step changes and to similar code and tests to follow. It does not decide anything the spec did not decide. If the step needs such a decision, ask the user.

10. Each step adds only behaviour that its own tests run. If code can only be tested once a later step exists, it goes into that later step.

11. If you see that it'd be worth to do PoC before planning, double check with user and do it through subagent with a fresh context and store all findings in the subfolder of the spec named by the research topic. This subagent should continuously update progress.md in their research subfolder.

12. If you found something that was missed, store what you have in spec.md and ask if user would like to go back to q&a.

13. After finishing please review for consistency with spec. Ensure you didn't make anything up, and all features/scenarios/acceptance criteria are covered and other rules defined in spec. Check if you didn't provide hacks and that you follow the state of the art in repo and you didn't try to monkey patch without acceptance.

Store the plan in plan.md in the folder where spec lives. Also create a todo.md to keep state accordingly. Use the templates below for both.

After each write or update of the plan, run `review-plan` in a fresh-context subagent before showing the plan to the user.

<plan-template>

# Plan: <feature>

Spec: `spec.md`. Q&A: `qa.md`.

## Terms

Each term the steps use, with its meaning from the spec.

---

## Step <n>. <title>

```text
Use the `implement-step` skill.

What to build
The behaviour this step makes work, from the user's perspective.

Context
The existing code this step changes or builds on: where it lives and how it works today.

Similar code
Existing code and tests that do something similar, to follow as the pattern.

Blocked by
The earlier steps this one needs, or "None".

Acceptance criteria
- <number> <criterion, copied from the spec>

Tests
- <criterion number>: <test name> - asserts <what>
- extra: <test name> - covers <edge case, error path or branch>
```

</plan-template>

<todo-template>

# Todo: <feature>

Plan: `plan.md`. Spec: `spec.md`.

## Steps

- [ ] <n>. <step title> (<criteria numbers>)

</todo-template>
