# How-to Guide Documentation Reference

## Overview

How-to guides are **goal-oriented directions** that help users accomplish specific tasks or solve real problems. They guide action through practical steps focused on what users want to achieve.

## Core Definition

How-to guides assume competence and focus exclusively on helping users accomplish a specific, known goal. They are about **action and only action** no teaching, no explanation, no reference material.

## Critical Distinction: How-to Guide vs Tutorial

This is the **most commonly confused distinction** in documentation. Both contain steps, but they serve fundamentally different purposes:

| Aspect             | How-to Guide                                                        | Tutorial                                                                                 |
| ------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **User knowledge** | Already knows what they want to achieve                             | Learner may not know enough to even ask the right questions                              |
| **Approach**       | General—many things unknowable in advance or different in each case | Concrete and particular—specific, known tools and materials we've set before the learner |
| **Path structure** | Forks and branches, different routes to same destination            | Single line, no choices or alternatives                                                  |
| **Completeness**   | Doesn't need to be complete—starts/ends at reasonable points        | Must be complete end-to-end guide                                                        |
| **Safety**         | Cannot promise safety—often only one chance to get it right         | Must be safe—no harm can come, always possible to go back and start again                |
| **Responsibility** | User has responsibility for getting in and out of trouble           | Teacher has responsibility—if learner gets in trouble, teacher must fix it               |
| **Focus**          | Work—accomplishing tasks                                            | Study—learning skills                                                                    |

**Good how-to guide examples:**

- "How to configure SSL certificates"
- "How to store cellulose nitrate film"
- "How to configure frame profiling"
- "Troubleshooting deployment problems"

**NOT how-to guides** (too broad, really need tutorials):

- "How to build a web application"
- "How to use the API"

## Key Principles

### 1. Focus on User Goals, Not Tools

**User-Centered Perspective:**

- "How-to guides must be written from the perspective of the user, not of the machinery"
- Address real-world human needs and purposes
- Tools should be incidental to the larger human goal
- Think about what users want to accomplish, not what the software can do

**Omit the Obvious:**

- Skip trivial technical steps users should already know
- Don't include foundational concepts or basic operations
- Assume baseline competence with the tools

**Example Distinction:**

- Poor: "How to use the API" (tool-centered)
- Good: "How to integrate application performance monitoring" (user-centered goal)

### 2. Assume Competence

**Target Audience:**

- Serve already-competent users who know what they want to achieve
- Users understand their goal and have chosen to pursue it
- Don't include teaching or foundational explanations
- Expect readers can follow instructions correctly

**Not for Beginners:**

- How-to guides are not tutorials
- They don't teach from scratch
- They guide practitioners toward specific outcomes

### 3. Maintain Laser Focus

**Action Only:**

- Stay centered on the specific task or problem
- Avoid digression, explanation, or reference material
- Every sentence should advance the user toward their goal
- Remove anything that doesn't directly serve task completion

**What to Exclude:**

- Teaching moments or conceptual explanations
- Complete reference material or option catalogs
- Historical context or design rationale
- Exploration of alternatives (unless directly relevant)

**Linking Out:**

- If additional context matters, link to it externally
- Point to explanation documentation for "why"
- Reference API docs for complete option lists
- Link to tutorials for foundational learning

### 4. Embrace Key Characteristics

**Task/Problem Focus:**

- Each guide addresses one specific goal or problem
- Title clearly states what will be accomplished
- Content delivers on that promise exclusively

**Practical Usability Over Completeness:**

- Better to be useful for real scenarios than theoretically complete
- Address actual use cases, not every possible variation
- Optimize for practitioners doing real work

## Structural Guidelines

### Sequence and Logic

**Temporal Order:**

- Organize steps in the order they must be performed
- Each step builds meaningfully on previous ones
- Follow natural workflow progression

**Meaningful Progression:**

- Consider how users think about the task
- Structure reflects practical necessity
- Anticipate mental model and workflow

### Flow

**Smooth Progress:**

- Anticipate user needs like a helpful assistant
- Minimize context-switching between tools
- Structure thinking progression naturally
- "Seek flow: smooth progress"

**Rhythm:**

- Maintain consistent pacing
- Balance detail with forward momentum
- Keep users moving toward completion

### Adaptability

**Real-World Flexibility:**

- Address real-world complexity and variation
- Allow users to adapt guidance to their situations
- Don't over-specify narrow use cases
- Acknowledge when choices depend on context

**Conditional Guidance:**

- "If you want x, do y"
- "When z is true, use approach a"
- Provide decision points where relevant

## Naming and Language

### Title Guidelines

**Clear Statement of Outcome:**

- State exactly what the guide accomplishes
- Use "How to..." format
- Avoid ambiguous titles that leave purpose unclear

**Good Examples:**

- "How to integrate application performance monitoring"
- "How to deploy a Django application"
- "How to configure SSL certificates"
- "How to migrate data between databases"

**Poor Examples:**

- "Application performance monitoring" (unclear intenttutorial? reference?)
- "Working with databases" (too vague)
- "Deployment" (what about it?)

### Voice and Phrasing

**Conditional Imperatives:**

- "If you want x, do y"
- "To accomplish z, follow these steps"
- "When a happens, perform b"

**Opening Patterns:**

- "This guide shows you how to..."
- "Follow these steps to..."
- "To [accomplish goal], you need to..."

**Reference to Other Materials:**

- "Refer to the x reference guide for full options"
- "See the y tutorial for an introduction"
- "For background on z, consult the explanation documentation"

### Imperative Tone

- Direct, action-oriented language
- "Configure the settings..."
- "Run the command..."
- "Add the following code..."

## What NOT to Include

### Tutorials Are Different

- How-to guides ` complete end-to-end teaching
- Don't try to teach concepts while guiding tasks
- Don't include learning exercises
- Don't explain foundational principles

### Avoid Procedural-Only Thinking

- Problems need adaptability, not just procedures
- Allow for variation in user context
- Don't be so rigid that guides fail in real scenarios

### No Teaching Moments

- Resist the urge to explain while instructing
- Keep foundational explanations out
- Link to explanation docs instead

### Not a Complete Reference

- Don't document every option or parameter
- Include only what's needed for the task
- Link to reference docs for completeness

### Minimize Digression

- No historical context (that's explanation)
- No exploration of alternatives (unless directly relevant)
- No tangential information
- Stay on the path to goal completion

## The Recipe Model

Cooking recipes exemplify strong how-to documentation:

**Clear Problem Statement:**

- Recipe title tells you what you'll make
- Ingredients list shows what you need

**Focused Instructions:**

- Steps directed at the goal
- No tangents about history of the dish
- No explanation of why techniques work

**Required Baseline Competence:**

- Assumes you can chop, stir, measure
- Doesn't teach basic kitchen skills
- Focuses on this specific dish

**Established Format:**

- Consistent structure across recipes
- Users know what to expect
- Easy to scan and follow

**Practical Orientation:**

- Real-world cooking, not culinary theory
- Adaptable to your kitchen and ingredients
- Gets you to edible result

## Common Pitfalls

1. **Mixing Teaching with Tasks**
   - Don't explain concepts while giving instructions
   - Keep learning and doing separate

2. **Tool-Centered Writing**
   - Don't organize around software features
   - Focus on what users want to accomplish

3. **Over-Specification**
   - Don't make guides so narrow they're not adaptable
   - Allow for real-world variation

4. **Scope Creep**
   - Don't let guides expand into tutorials or reference
   - Stay focused on the single task

5. **Missing the Goal**
   - Don't forget to state what will be accomplished
   - Make the outcome crystal clear

## When to Write How-to Guides

Write how-to guides when users need to:

- Accomplish a specific, defined task
- Solve a particular problem
- Integrate your product with another system
- Configure something for a specific use case
- Perform a known operation successfully

## When NOT to Write How-to Guides

Don't write how-to guides when users need to:

- Learn concepts from scratch (use tutorials)
- Look up technical details (use reference)
- Understand why things work (use explanation)
- Get their first experience with the product (use tutorial)

## Checklist for Writing How-to Guides

- [ ] Focuses on a specific, clearly-stated goal
- [ ] Title uses "How to..." format and states outcome
- [ ] Assumes user competence with basics
- [ ] User-centered, not tool-centered
- [ ] Steps in logical, temporal order
- [ ] Action-oriented with minimal explanation
- [ ] Adaptable to real-world variations
- [ ] No teaching or foundational concepts
- [ ] No complete reference material (links instead)
- [ ] No historical context or design rationale
- [ ] Maintains flow and forward momentum
- [ ] Each step advances toward the goal
- [ ] Links to tutorials, reference, and explanation as needed
