# Explanation Documentation Reference

## Overview

Explanation is **understanding-oriented** documentation that deepens reader comprehension through reflective, discursive treatment of topics. It answers: "Can you tell me about&?"

## Core Purpose

Explanation operates at a higher, broader perspective than tutorials, how-to guides, or reference material. It focuses on theoretical knowledge and context rather than immediate application, best consumed away from active work (not during task execution).

## Distance from Practice

Explanation is "characterised by its distance from the active concerns of the practitioner." While potentially less urgent than other documentation types, it remains equally important for building robust understanding.

## Critical Distinction: Explanation vs Reference

Both provide knowledge (cognition), but for fundamentally different contexts:

| Test Question                                          | If Yes → Explanation | If No → Reference |
| ------------------------------------------------------ | -------------------- | ----------------- |
| Could you imagine **reading this in the bath**?        | ✓                    |                   |
| Does it primarily answer **"why?" questions**?         | ✓                    |                   |
| Would someone turn to this **while actively working**? |                      | ✓                 |
| Is it **lists, tables, or technical specs**?           |                      | ✓                 |

**Key insight**: A tidal chart with tables of figures is clearly reference. An article explaining why there are tides and how they behave is clearly explanation.

**Explanation examples:**

- "About user authentication" (why the system works this way)
- "Database architecture" (how components relate)
- "Design decisions in the permission system"
- "The evolution of our API design"

**Reference examples (NOT explanation):**

- API endpoint documentation
- Configuration option lists
- Error code tables
- Command syntax specifications

## Essential Guidelines

### Make Connections

- Link topics to related concepts, even beyond immediate scope
- Weave understanding across domains
- Draw relationships between different parts of the system
- Connect to broader technical or domain concepts

### Provide Context

Explanation should illuminate:

- **Design decisions**: Why was this approach chosen?
- **Historical reasons**: How did this evolve over time?
- **Technical constraints**: What limitations influenced this design?
- **Implications**: What does this mean for users/developers?
- **Specific examples**: Concrete illustrations of abstract concepts

### Address the Bigger Picture

Discussion topics should include:

- **History and evolution**: How did we get here?
- **Choices and alternatives**: What other approaches exist?
- **Reasons and justifications**: Why this way and not another?
- **Multiple perspectives**: Different viewpoints on the same question
- **Trade-offs**: What are the costs and benefits?

## Structural Principles

### Maintain Clear Boundaries

- Prevent explanation from absorbing instructional or reference content
- Keep material focused on the defined topic area
- Use "why questions" as prompts to define scope
- Don't let explanation become a tutorial or how-to guide
- Don't include detailed technical specifications (that's reference material)

### Naming Convention

- Use titles that allow an implicit "About" prefix
  - Good: "User authentication" (reads as "About user authentication")
  - Good: "The request-response cycle"
  - Good: "Database normalization"
- Reflects the discursive nature of the material
- Avoids action-oriented or task-oriented phrasing

## Language Patterns

Effective explanation employs constructions like:

- **Justification**: "The reason for x is because historically, y&"
- **Professional judgment**: "W is better than z, because&"
- **Contextual comparison**: "An x is analogous to w. However&"
- **Weighing alternatives**: "Some users prefer w. This can be good, but&"
- **Unfolding mechanics**: "An x interacts with y as follows&"
- **Historical context**: "Originally, the system used x, but this evolved to y when&"
- **Design rationale**: "We chose this approach because&"

## Critical Attitudes

### Embrace Opinion and Perspective

- Acknowledge that understanding emerges from particular viewpoints
- Present alternative approaches and counter-examples
- Offer professional judgment and reasoned opinions
- Think of explanation as **discussion** rather than instruction
- It's acceptable to express preference with justification

### Voice and Tone

- More discursive and reflective than other documentation types
- Can be contemplative and exploratory
- Allows for nuance and complexity
- Can acknowledge uncertainty or multiple valid approaches

## Common Mistakes to Avoid

1. **Don't underestimate explanation's importance**
   - While less immediately urgent, it's crucial for deep understanding
   - Without explanation, users have fragmented, surface-level knowledge

2. **Don't allow instructional content to infiltrate**
   - Keep "how to do things" in how-to guides
   - Don't provide step-by-step instructions
   - Link to tutorials/guides rather than embedding them

3. **Don't allow technical reference to infiltrate**
   - Keep detailed API specs, parameters, and technical descriptions in reference
   - Link to reference material rather than duplicating it

4. **Don't leave scope undefined**
   - Use guiding questions to bound the topic
   - Define what is and isn't covered
   - Stay focused on the defined subject area

## Reference Model

Harold McGee's _On Food and Cooking_ exemplifies explanation perfectly:

- Explores cooking through history, society, and science
- **Contains no recipes** (those would be how-to guides)
- Changes how practitioners think about their craft
- Provides understanding rather than directing immediate action
- Readers consume it away from the kitchen for learning

## When to Write Explanation

Write explanation documentation when users need to:

- Understand the "why" behind design decisions
- Grasp the broader context of a system or feature
- Learn about alternatives and trade-offs
- Build mental models of how components relate
- Understand historical evolution and rationale
- Prepare for advanced work requiring deep understanding

## When NOT to Write Explanation

Don't write explanation when users need to:

- Learn by doing (use tutorials)
- Accomplish a specific task (use how-to guides)
- Look up technical details (use reference)
- Get started quickly (use tutorials or how-to guides)

## Checklist for Writing Explanation

- [ ] Focuses on understanding, not action
- [ ] Provides context and connections
- [ ] Explores alternatives and trade-offs
- [ ] Explains the "why" behind decisions
- [ ] Can be read away from active work
- [ ] Contains no step-by-step instructions
- [ ] Contains no detailed technical specifications
- [ ] Discusses broader concepts and relationships
- [ ] Title works with implicit "About" prefix
- [ ] Acknowledges multiple perspectives where appropriate
- [ ] Links to tutorials, how-to guides, and reference as needed
