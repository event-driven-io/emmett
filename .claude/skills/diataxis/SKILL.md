---
name: diataxis
description: Centralizes Diataxis documentation framework guidance so Claude can write, review, or improve documentation following the four distinct types (tutorials, how-to guides, reference, explanation).
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

# Diataxis Skill

Unifies all Diataxis documentation guidance into one Skill. Claude activates this Skill whenever documentation should be written, reviewed, or improved, and then "lazy loads" the exact documentation type guidance by opening the reference docs linked below.

## Critical Workflow

**REQUIRED**: Before writing or reviewing ANY documentation, you MUST load the relevant documentation type reference file(s) using the Read tool.

1. **Use the Compass** to identify the documentation type needed (see below)
2. **Read the matching reference file(s)** BEFORE writing/reviewing:
   - Learning experiences → Read `references/tutorials.md`
   - Task-oriented guides → Read `references/how-to-guides.md`
   - Information lookup → Read `references/reference.md`
   - Understanding & context → Read `references/explanation.md`
3. **Apply the documentation type's principles** from the loaded reference
4. Write or review documentation according to that type's standards

**DO NOT attempt to write or review documentation without first loading the appropriate reference file(s).**

## The Diataxis Compass

The compass is your primary decision-making tool. Ask two questions:

### Question 1: Action or Cognition?

- **Action** = Practical steps, doing things, hands-on work
- **Cognition** = Theoretical knowledge, thinking, understanding

### Question 2: Acquisition or Application?

- **Acquisition** = Study, learning something new
- **Application** = Work, using skills to accomplish tasks

### The Four Quadrants

```
                    ACQUISITION              APPLICATION
                    (Study)                  (Work)
              ┌─────────────────────┬─────────────────────┐
              │                     │                     │
   ACTION     │     TUTORIALS       │    HOW-TO GUIDES    │
   (Doing)    │   Learning-oriented │    Task-oriented    │
              │   "Teach me"        │    "Help me do X"   │
              │                     │                     │
              ├─────────────────────┼─────────────────────┤
              │                     │                     │
   COGNITION  │    EXPLANATION      │     REFERENCE       │
   (Knowing)  │ Understanding-      │  Information-       │
              │    oriented         │     oriented        │
              │   "Help me          │    "What is the     │
              │    understand"      │     spec for X?"    │
              └─────────────────────┴─────────────────────┘
```

### Quick Decision Guide

| User Need                            | Action/Cognition | Acquisition/Application | → Type      |
| ------------------------------------ | ---------------- | ----------------------- | ----------- |
| "How do I get started?"              | Action           | Acquisition             | Tutorial    |
| "How do I deploy to prod?"           | Action           | Application             | How-to      |
| "What parameters does X accept?"     | Cognition        | Application             | Reference   |
| "Why does the system work this way?" | Cognition        | Acquisition             | Explanation |

## Key Distinctions (Critical!)

### Tutorial vs How-to Guide

Both contain steps, but serve fundamentally different purposes:

| Aspect             | Tutorial                                      | How-to Guide                                |
| ------------------ | --------------------------------------------- | ------------------------------------------- |
| **User**           | Learner, may not know enough to ask questions | Competent practitioner who knows their goal |
| **Responsibility** | Teacher bears responsibility for success      | User bears responsibility for outcomes      |
| **Approach**       | Concrete, specific, controlled environment    | General, adaptable to real-world variation  |
| **Path**           | Single path, no choices                       | Multiple routes, branching options          |
| **Completeness**   | Must be complete end-to-end                   | Can start/end at reasonable points          |
| **Safety**         | Must be safe, can always restart              | Cannot promise safety                       |
| **Focus**          | Learning through doing                        | Getting work done                           |

### Reference vs Explanation

Both provide knowledge, but for different contexts:

| Test Question                                      | If Yes →    | If No →     |
| -------------------------------------------------- | ----------- | ----------- |
| Would someone turn to this while actively working? | Reference   | Explanation |
| Could you imagine reading this in the bath?        | Explanation | Reference   |
| Is it lists, tables, or technical specs?           | Reference   | Explanation |
| Does it answer "why?" questions?                   | Explanation | Reference   |

## Applying Diataxis: Iterative Approach

**Do NOT create empty structures.** Don't create `/tutorials`, `/how-to`, `/reference`, `/explanation` folders with nothing in them.

**Start small:**

1. Pick any existing documentation
2. Apply compass to determine what type it should be
3. Improve it according to that type's principles
4. Repeat

**Let structure emerge:** As you improve individual pieces, patterns will emerge that suggest organizational structure. The top-level structure forms from the inside out.

## Documentation Type References (load on demand)

- **[Tutorials](references/tutorials.md)** - Learning-oriented experiences enabling skill acquisition through guided practice
- **[How-to Guides](references/how-to-guides.md)** - Task-oriented directions for accomplishing specific goals
- **[Reference](references/reference.md)** - Information-oriented technical descriptions for authoritative lookup
- **[Explanation](references/explanation.md)** - Understanding-oriented discussions providing context and answering "why?"

## Key Principles

1. **Different contexts need different documentation** - Users learning need tutorials; users working need how-to guides or reference; users seeking understanding need explanation
2. **Separation of concerns** - Keep documentation types distinct to prevent confusion
3. **User-centered approach** - Consider what the user is trying to accomplish and in what context
4. **Iterative improvement** - Enhance documentation incrementally by applying Diataxis principles
5. **Purpose-driven structure** - Each type has specific characteristics that make it effective for its intended purpose

## Overview

Diataxis is a systematic framework for organizing and writing technical documentation. It addresses three fundamental challenges in documentation:

- **Content**: What to write
- **Style**: How to write it
- **Architecture**: How to organize it

The framework is lightweight, practical, and user-centered, emerging from analysis of actual documentation user needs. It has been adopted by hundreds of projects including major organizations like Gatsby, Cloudflare, and Vonage.

## The Four Documentation Types

Diataxis organizes documentation into four distinct types, each serving specific user needs and contexts:

### 1. Tutorials (Learning-Oriented)

**Purpose**: Learning experiences that prioritize skill and knowledge acquisition through guided practice.

**Key Characteristics**:

- Provide experiences that enable learning rather than direct teaching
- Function as lessons where the instructor bears primary responsibility
- Must be meaningful, successful, logical, and usefully complete
- Focus on study rather than task completion

**Core Principles**:

1. Don't teach directly—provide experiences enabling learning
2. Show destination upfront to orient learners
3. Deliver early, frequent results for rapid feedback
4. Maintain narrative expectations to keep learners confident
5. Guide observation to highlight what matters
6. Enable the feeling of doing with rhythmic, pleasurable progression
7. Permit repetition to reinforce successful actions
8. Minimize explanation to avoid distraction
9. Stay concrete with specific actions and results
10. Ensure perfect reliability for learner confidence

**Language Patterns**:

- "We will..." (establishes collaboration)
- Imperative directives: "First, do x. Now, do y"
- "Notice that..." (provides orientation)
- "You have built..." (acknowledges accomplishments)

**Distinction**: Tutorials emphasize _acquisition and study_, while how-to guides facilitate _task completion_.

### 2. How-to Guides (Task-Oriented)

**Purpose**: Actionable directions for accomplishing specific tasks or solving real-world problems.

**Key Characteristics**:

- Goal-oriented for users who know what they want to achieve
- Focus on "action and only action"—no digression, explanation, or teaching
- Assume competent users who understand their objective
- Practical usability takes precedence over comprehensiveness

**Core Principles**:

1. **User-centered, not tool-centered**: Address human needs and purposes, not just machinery operations
2. **Logical sequencing**: Steps follow meaningful order reflecting both practical necessity and user thinking
3. **Adaptability**: Flexible enough for real-world variations
4. **Strategic naming**: Titles clearly state what will be accomplished ("How to integrate application performance monitoring")
5. **Omit extras**: Avoid unnecessary reference material or explanations; link to them instead

**Recipe Analogy**: Like cooking recipes, how-to guides address specific questions, assume basic competence, follow established formats, and exclude both teaching and historical context in favor of focused instructions.

**Distinction**: How-to guides direct already-competent practitioners toward specific outcomes, unlike tutorials that teach foundational skills to novices.

### 3. Reference (Information-Oriented)

**Purpose**: Technical descriptions providing the authoritative foundation needed for confident task execution.

**Key Characteristics**:

- Austere and neutral with objective, factual language
- Consulted for specific information rather than read narratively
- Authoritative through accuracy, precision, and completeness
- Structure mirrors the product's internal architecture

**What Makes It Effective**:

1. **Consistency**: Standard patterns allow effective use; information in familiar formats and predictable locations
2. **Pure description**: Describe and only describe—no recipes, instructions, or marketing claims
3. **Illustrative examples**: Succinct usage examples that clarify functionality
4. **Appropriate warnings**: Necessary cautions about requirements, restrictions, and limitations

**Structure**: Typically covers APIs, classes, functions, commands, options, features, flags, limitations, and error messages—organized according to the machinery's logical architecture.

**Distinction**: Reference provides propositional or theoretical knowledge users consult during their work, unlike the experiential focus of tutorials or action focus of how-to guides.

### 4. Explanation (Understanding-Oriented)

**Purpose**: Deepen reader comprehension through discursive treatment of subjects, providing context and answering "why?" questions.

**Key Characteristics**:

- Understanding-oriented with priority on reflection and context
- Suited for contemplative reading away from active work
- Takes broader perspective examining entire topics as coherent areas of knowledge
- Less urgent than other types but equally important for preventing fragmented knowledge

**Core Principles**:

1. **Make connections** across topics and domains
2. **Provide background**: Design decisions, historical context, technical constraints
3. **Discuss alternatives** and multiple perspectives
4. **Admit opinion**: Acknowledge that understanding involves particular viewpoints
5. **Stay bounded**: Resist absorbing instructional or reference content

**Language Patterns**:

- "The reason for x is because historically, y..."
- "An x interacts with a y as follows..."
- Patterns that reveal underlying mechanics and justify design choices

**Distinction**: Explanation provides context and understanding for study, unlike the immediate work application of how-to guides and reference material.

## The Organizational Framework

Diataxis uses two intersecting axes to organize the four documentation types:

- **Vertical Axis**: Action (what users do) versus Cognition (what users know)
- **Horizontal Axis**: Study (skill acquisition) versus Work (skill application)

This creates four quadrants:

```
              Study                    Work
         _______________________________________________
        |                    |                        |
Action  |    Tutorials       |    How-to Guides      |
        |   (learning)       |      (tasks)          |
        |____________________|_______________________|
        |                    |                        |
Cogni-  |   Explanation      |      Reference        |
tion    | (understanding)    |    (information)      |
        |____________________|_______________________|
```

Understanding these boundaries helps prevent common documentation problems caused by blurring categories.

## The Compass: A Practical Decision Tool

The compass reduces the two-dimensional Diataxis problem to two simple questions:

### Question 1: Action or Cognition?

- **Action** = Practical steps, doing things, hands-on work
- **Cognition** = Theoretical knowledge, thinking, understanding

### Question 2: Acquisition or Application?

- **Acquisition** = Study, learning something new
- **Application** = Work, using skills to accomplish tasks

### Quick Decision Table

| Need                                 | Action/Cognition | Acquisition/Application | → Type          |
| ------------------------------------ | ---------------- | ----------------------- | --------------- |
| "How do I get started?"              | Action           | Acquisition             | **Tutorial**    |
| "How do I deploy to prod?"           | Action           | Application             | **How-to**      |
| "What parameters does X accept?"     | Cognition        | Application             | **Reference**   |
| "Why does the system work this way?" | Cognition        | Acquisition             | **Explanation** |

### Critical Distinctions

**Tutorial vs How-to Guide** (most commonly confused):

- Tutorials: Learner may not know enough to ask questions; single path; teacher responsible
- How-to: User knows their goal; can branch/adapt; user responsible

**Reference vs Explanation**:

- Reference: Turn to it while working; lists, tables, specs
- Explanation: Read away from work (could read in the bath); answers "why?"

## Benefits of Diataxis

**For Users**:

- Clear navigation to the right information for their current need
- Appropriate content style for their context (learning vs. working)
- Reduced frustration from mixed-purpose documentation

**For Documentation Teams**:

- Clear decision framework for what to write and where
- Structured approach to evaluating documentation quality
- Actionable principles for maintainers
- Better contributor satisfaction through clear guidelines

**For Organizations**:

- Improved user experience
- More maintainable documentation
- Scalable documentation architecture
- Proven framework adopted by industry leaders

## Implementation Approach

Diataxis recommends **iterative improvement from the inside out**:

### What NOT to Do

**Don't create empty structures.** Never create `/tutorials`, `/how-to`, `/reference`, `/explanation` folders with nothing in them. This is counterproductive and creates false expectations.

### The Iterative Workflow

1. **Choose any piece** of existing documentation
2. **Apply the compass** to determine what type it should be
3. **Improve it** according to that type's principles
4. **Repeat**

### Let Structure Emerge

As you improve individual pieces, patterns will emerge that suggest organizational structure. The top-level Diataxis structure should form organically from the inside out, not be imposed top-down.

**Key insight**: Diataxis changes the structure of your documentation from the inside. The structure is a guide and compass, not a plan you must complete.

## Key Takeaways

1. **Different needs require different documentation**: Users studying to learn need different content than users working to accomplish tasks
2. **Separation of concerns**: Keeping documentation types distinct prevents common problems like mixing teaching with task instructions
3. **Structure follows purpose**: Each documentation type has specific characteristics that make it effective for its purpose
4. **User-centered design**: The framework emerges from understanding actual user needs in different contexts
5. **Pragmatic adoption**: Implement incrementally rather than requiring wholesale changes
6. **Quality compass**: Provides clear criteria for evaluating whether documentation serves its intended purpose

---

_Source: [Diataxis Framework](https://diataxis.fr/)_
