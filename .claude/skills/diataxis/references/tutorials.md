# Tutorial Documentation Reference

## Overview

A tutorial is a **learning-oriented, practical activity** where students learn by doing meaningful tasks toward achievable goals. It's a lesson, not a task completion guide.

## Core Definition

Tutorials are experiences that enable learning through doing. The tutorial author bears primary responsibility for the learner's success. Tutorials prioritize skill and knowledge acquisition, not task completion.

## The Teacher's Contract

Nearly all responsibility falls on the teacher. The student's only obligation is attentiveness and following directions.

**The Exercise Must Be:**

- **Meaningful**: Provides sense of achievement
- **Successful**: Completable by the learner
- **Logical**: Coherent progression that makes sense
- **Usefully complete**: Exposes all necessary actions, concepts, and tools

## Critical Distinction: Tutorial vs How-to Guide

This is the **most commonly confused distinction** in documentation. Both contain steps, but they serve fundamentally different purposes:

| Aspect             | Tutorial                                                                                 | How-to Guide                                                        |
| ------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **User knowledge** | Learner may not know enough to even ask the right questions                              | Already knows what they want to achieve                             |
| **Approach**       | Concrete and particular—specific, known tools and materials we've set before the learner | General—many things unknowable in advance or different in each case |
| **Path structure** | Single line, no choices or alternatives                                                  | Forks and branches, different routes to same destination            |
| **Completeness**   | Must be complete end-to-end guide                                                        | Doesn't need to be complete—starts/ends at reasonable points        |
| **Safety**         | Must be safe—no harm can come, always possible to go back and start again                | Cannot promise safety—often only one chance to get it right         |
| **Responsibility** | Teacher has responsibility—if learner gets in trouble, teacher must fix it               | User has responsibility for getting in and out of trouble           |
| **Focus**          | Study—learning skills                                                                    | Work—accomplishing tasks                                            |

**Key insight**: You will revise tutorials far more than other docs. Unlike how-to guides (which only change when the product changes), you may completely rewrite a tutorial because you found a better learning experience.

## The 11 Core Principles

### 1. Don't Try to Teach

"Your job, as a teacher, is to provide the learner with an experience that will allow them to learn."

- Focus on enabling learning through doing, not explanation
- Provide experiences, not lectures
- Let understanding emerge from practice
- The learner learns by doing, not by being told

### 2. Show the Destination Upfront

**Orient the Learner:**

- Inform learners what they'll accomplish at the start
- Example: "In this tutorial we will create and deploy a scalable web application"
- Avoid presumptuous "you will learn" phrasing
- Give learners confidence in where they're heading

**Why This Matters:**

- Reduces anxiety and uncertainty
- Provides context for upcoming steps
- Helps learners see the value of the journey

### 3. Deliver Visible Results Early and Often

**Rapid Feedback Loops:**

- Every step must produce comprehensible results
- Learners should see changes after each action
- Enable cause-and-effect connections repeatedly
- Build confidence through immediate success

**The Power of Results:**

- Validates that learners are on track
- Reinforces correct actions
- Maintains engagement and motivation
- Allows learners to verify their progress

### 4. Maintain Narrative Expectations

**Guide What to Expect:**

- Use phrases like "You will notice that&"
- Show actual expected output
- Warn about likely confusion points
- Provide reassurance throughout

**Example Patterns:**

- "The output should look like&"
- "Notice that the prompt has changed to&"
- "You should now see&"
- "This may take a few moments&"

### 5. Point Out What Learners Should Notice

"Learning requires reflection."

**Active Observation Guidance:**

- Explicitly highlight environmental changes
- Point out important details
- Draw attention to significant results
- Don't assume learners notice things independently

**Examples:**

- "Notice that the prompt now shows (venv)"
- "The terminal output indicates success with&"
- "Observe how the interface has changed&"

### 6. Target the Feeling of Doing

**Flow State Creation:**

- Build tasks that connect: purpose � action � thinking � result
- Create rhythmic, pleasurable progression
- Enable the satisfaction of skilled practice
- Let competence feel rewarding

**The Doing Experience:**

- Learners should feel actively engaged
- Each step should feel purposeful
- Progress should feel natural and inevitable
- Success should feel earned but achievable

### 7. Encourage Repetition

**Repetition Reinforces:**

- Allow steps to be repeated where possible
- Users naturally repeat successful steps
- Repetition confirms reliability
- Reinforcement builds confidence

**Why Repetition Works:**

- Solidifies new skills through practice
- Allows learners to internalize patterns
- Builds muscle memory for workflows
- Increases retention

### 8. Ruthlessly Minimize Explanation

"A tutorial is not the place for explanation."

**Keep Explanations Brief:**

- Learners are focused on correct execution
- Explanation distracts from doing
- Provide links to deeper explanation rather than embedding it
- Brief justifications only when absolutely necessary

**The Distraction Problem:**

- Explanation breaks the flow
- Diverts attention from the task
- Cognitive load increases
- Learners lose the thread

### 9. Focus on the Concrete

**Concrete Before Abstract:**

- Lead "from step to concrete step"
- Use specific examples, not generalizations
- The mind learns concrete-to-abstract, never the reverse
- General patterns emerge naturally from concrete practice

**Concrete Examples:**

- Use actual file names, not placeholders
- Show real commands, not templates
- Demonstrate with specific values
- Let abstraction emerge through experience

### 10. Ignore Options and Alternatives

**Single Path Only:**

- Exclude alternative commands or approaches
- No optional steps or variations
- Don't discuss different API methods
- Keep guidance focused on one successful path

**Why Single Path:**

- Prevents decision paralysis
- Reduces cognitive load
- Ensures tutorial reliability
- Allows focus on learning, not choosing

### 11. Aspire to Perfect Reliability

"Confidence builds incrementally and shatters quickly."

**Zero Tolerance for Failure:**

- Every promised result must materialize
- Tutorial must work every single time
- Test extensively with actual users
- Discover and eliminate hidden gaps

**The Confidence Factor:**

- One failure destroys trust
- Learners blame themselves for tutorial problems
- Unreliable tutorials create lasting negative impressions
- Perfect reliability is non-negotiable

## Anti-Pedagogical Temptations to Avoid

These common patterns sabotage learning:

1. **Abstraction and generalization**: Stay concrete
2. **Explanation and exposition**: Link to it, don't embed it
3. **Presenting choices**: Provide one clear path
4. **Information overload**: Ruthlessly minimize content

## Language Patterns

| Pattern                    | Purpose                            | Example                                            |
| -------------------------- | ---------------------------------- | -------------------------------------------------- |
| "We..."                    | Affirm tutor-learner collaboration | "In this tutorial, we will build&"                 |
| Imperative sequence        | Remove ambiguity                   | "First, do x. Now, do y. Next, do z."              |
| Minimal justification      | Provide just enough rationale      | "We must do x before y because& (see Explanation)" |
| Expected output            | Set clear expectations             | "The output should look like: [example]"           |
| Observation cues           | Guide attention                    | "Notice that& Remember that& Let's check&"         |
| Achievement acknowledgment | Affirm accomplishment              | "You have built a secure, three-layer application" |

## Voice and Tone

### Collaborative "We"

- "We will create a new file"
- "Now we'll add the configuration"
- "Let's run the command together"
- Emphasizes partnership in learning

### Confident, Reassuring

- Maintain certainty throughout
- Assure learners they're on the right track
- Acknowledge achievements
- Build confidence incrementally

### Active and Present

- Use present tense for actions
- Keep learners engaged in the moment
- Focus on immediate next step
- Maintain forward momentum

## Tutorial vs. How-to Guide Distinction

**Tutorials:**

- Emphasis on **acquisition and study**
- For learning new skills
- Teacher bears responsibility
- Complete learning journey
- Appropriate for novices
- Focus on education

**How-to Guides:**

- Facilitate **task completion**
- For applying known skills
- User bears responsibility
- Focused problem-solving
- Assume competence
- Focus on productivity

## The Cooking Analogy

Teaching a child to cook illustrates tutorial principles perfectly:

**Success Criteria:**

- Child learns skills and gains pleasure
- Not about perfect culinary output
- Learning happens "through the activities" together
- Not from instruction alone

**Incomplete Is Acceptable:**

- If the child achieved something
- If the child enjoyed it
- Skills will develop over time
- Foundation matters most

## Special Challenges of Tutorials

### Maintenance Burden

- Tutorials cascade through documentation
- Changes ripple across entire narrative
- Product evolution requires ongoing updates
- Breaking changes are especially problematic

### No Instructor Present

- Can't correct mistakes in real-time
- Can't check understanding
- Can't adapt to learner needs
- Must anticipate all problems

### Design Complexity

- Balancing "what to learn" and "what to do"
- Requires careful sequencing
- Must maintain perfect reliability
- Needs extensive testing with real users

## When to Write Tutorials

Write tutorials when users need to:

- Get their first hands-on experience
- Learn fundamental concepts through practice
- Build confidence with a new tool or system
- Understand basic workflows
- Achieve an early success that motivates further learning

## When NOT to Write Tutorials

Don't write tutorials when users need to:

- Complete a specific task (use how-to guides)
- Look up technical information (use reference)
- Understand why things work (use explanation)
- Apply skills they already have (use how-to guides)

## Checklist for Writing Tutorials

- [ ] Learning-oriented, not task-oriented
- [ ] Shows destination at the beginning
- [ ] Every step produces visible results
- [ ] Maintains narrative expectations throughout
- [ ] Points out what learners should notice
- [ ] Creates the feeling of doing
- [ ] Allows repetition where possible
- [ ] Minimizes explanation (links to it instead)
- [ ] Focuses on concrete steps, not abstractions
- [ ] Ignores options and alternatives
- [ ] Tested for perfect reliability
- [ ] Uses "we" language to build partnership
- [ ] Acknowledges learner achievements
- [ ] No choices or decision points
- [ ] Complete learning experience from start to finish
- [ ] Links to how-to guides, reference, and explanation as needed
