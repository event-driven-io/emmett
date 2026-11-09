---
name: specification
description: Turn an idea into a detailed specification. Use when the user wants to refine an idea before implementation.
---

# Specify an idea

This skill takes the current conversation context and codebase understanding and produces a spec. Do NOT interview the user; just synthesize what you already know.

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the spec, and respect documentation in the area you're touching.

2. Sketch out the seams at which you're going to test the feature. Existing seams should be preferred to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can. The fewer seams across the codebase, the better - the ideal number is one.

Check with the user that these seams match their expectations.

3. Write the spec using the template below.

4. If you found something that was missed or is still open, store what you have in spec.md and ask if user would like to go back to q&a.

5. Spec must not have any open items, unless they're explicitly marked by user as out of scope or follow up items. You must never make such decisions on your own.

Store spec in spec.md, if you're doing it based on qa.md, keep it in the same subfolder.

<spec-template>

## Problem Statement

The problem that the user is facing, from the user's perspective and the goal.

## Solution

The solution to the problem, from the user's perspective. It should use simple explanation, but not simplistic following the gradual explanation. You should avoid strawman arguments, explain, not advocate. Where it makes sense add diagrams and explanation, but not make it verbose. Ensure that both human and agent will know what's to be done and how. Avoid unnessesary technical details.

## Acceptance criteria

A LONG, numbered list of scenarios focused on the usage and user (system can also be a user) for the discussed feature. Break down writing a scenario (or test) into three sections:

- The given part describes the state of the world before you begin the behavior you're specifying in this scenario. You can think of it as the pre-conditions to the test.
- The when section is that behavior that you're specifying.
- Finally the then section describes the changes you expect due to the specified behavior.

<feature>
1. <actor> <action> <condition>, so that <benefit>
  1.1 Given <example>

Example:

Projection rebuild

1. User requests single stream projection rebuild, so they can get read model with new logic and data.
   1.1. GIVEN no other rebuild for this projection is running AND rebuild doesn't truncate the storage WHEN rebuild is started through consumer THEN new storage for read model is created AND old model is untouched after consumer processed all existing events

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this spec.

## Further Notes

Any further notes about the feature.

</spec-template>
