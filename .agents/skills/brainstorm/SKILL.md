---
name: brainstorm
description: Develop an idea iteratively into a detailed specification by asking one question at a time. Use when the user wants to brainstorm or refine an idea before implementation.
---

# Brainstorm an idea

Turn the user's idea into a detailed specification that can be handed to a developer.

Create the subfolder for this q&a.

Ask exactly one question at a time. Each question should build on the previous answers and resolve the most important remaining uncertainty.

Before asking the next question, append the previous question and itsverbatim answer to `qa.md` stored in subfolder created for this q&a. Do not combine multiple questions into one message.

Continue until the goals, scope, behavior, constraints, edge cases, and relevant technical decisions are clear. Then ask whether the user is ready for the specification to be written. Only after confirmation, call the Skill tool with `specification`.

When you are asked to do research or doublecheck, please do it through subagent with a fresh context and store all findings in the subfolder of this q&a named by the research topic. This subagent should continuously update progress.md in their research subfolder.
