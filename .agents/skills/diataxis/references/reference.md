# Reference Documentation Reference

## Overview

Reference guides provide **technical descriptions** that are **information-oriented**. They contain propositional/theoretical knowledge users consult during work, not learn from sequentially.

## Core Purpose

Reference documentation serves as the authoritative source of technical truth about the product. Users consult it to look up specific information they need while working, not to learn sequentially or complete tasks.

## Critical Distinction: Reference vs Explanation

Both provide knowledge (cognition), but for fundamentally different contexts:

| Test Question                                          | If Yes → Reference | If No → Explanation |
| ------------------------------------------------------ | ------------------ | ------------------- |
| Would someone turn to this **while actively working**? | ✓                  |                     |
| Is it **lists, tables, or technical specs**?           | ✓                  |                     |
| Could you imagine **reading this in the bath**?        |                    | ✓                   |
| Does it primarily answer **"why?" questions**?         |                    | ✓                   |

**Key insight**: A tidal chart with tables of figures is clearly reference. An article explaining why there are tides and how they behave is clearly explanation.

**Reference examples:**

- API endpoint documentation
- Configuration option lists
- Error code tables
- Command syntax specifications

**Explanation examples:**

- "About user authentication" (why the system works this way)
- "Database architecture" (how components relate)
- "Design decisions in the permission system"

## Key Principles

### 1. Describe and Only Describe

**Austere, Uncompromising Style:**

- Maintain **neutral, objective, factual** language
- Use an **austere and uncompromising** style
- Prioritize accuracy, precision, completeness, and clarity
- No opinions, no marketing, no speculation

**Pure Description:**

- Avoid instruction, explanation, opinion, or discussion
- Link to tutorials, how-to guides, or explanation rather than embedding them
- State what something **is** and what it **does**, not how to use it or why

**Mirror the Machinery:**

- Structure content to mirror the product's structure itself, not user tasks
- Document the architecture as it exists
- Help users navigate code and documentation in parallel

### 2. Adopt Standard Patterns

"Reference material is useful when it is consistent."

**Consistency Requirements:**

- Use standardized formatting throughout
- Place information where users expect it
- Maintain familiar formats across all reference pages
- Create predictable patterns users can rely on

**Standard Elements:**

- Function/method signatures
- Parameter descriptions
- Return values
- Error conditions
- Examples of usage

### 3. Respect the Structure of the Machinery

**Structural Alignment:**

- Documentation structure should mirror the product's structure
- Users navigate them in parallel
- Helps readers understand relationships between components logically
- Reflects the internal architecture and organization

**Common Reference Structures:**

- APIs and endpoints
- Classes and methods
- Commands and subcommands
- Configuration options
- Data structures
- Error codes and messages

### 4. Provide Examples

**Illustrative, Not Pedagogical:**

- Use examples to illustrate usage succinctly
- Show context without explaining or teaching
- Demonstrate syntax and format
- Keep examples minimal and focused

**Example Characteristics:**

- Brief and to the point
- Show actual usage in context
- Include input and output where relevant
- No explanatory narrative

## Language Patterns

### Do Use:

- **Factual statements**: "Django's default logging configuration inherits Python's defaults"
- **Declarative descriptions**: "The `authenticate()` method returns a User object or None"
- **Lists of capabilities**: "This command accepts the following options..."
- **Directive warnings**: "You must use a. You must not apply b unless c."
- **Technical specifications**: "Accepts integers between 0 and 255"
- **Behavioral descriptions**: "When x occurs, the system responds with y"

### Avoid:

- Marketing claims ("best", "powerful", "easy")
- Instructions ("First, do this, then do that")
- Recipes or step-by-step procedures
- Opinions or recommendations ("you should", "it's better to")
- Explanations of why things work this way
- Speculation about future changes

## Content to Include

### Essential Elements

**For Functions/Methods:**

- Name and signature
- Purpose (what it does, not how to use it)
- Parameters with types and descriptions
- Return values and types
- Exceptions/errors that may be raised
- Brief usage example

**For Commands:**

- Command syntax
- Available options and flags
- Arguments and their formats
- Output format
- Exit codes
- Error conditions

**For APIs:**

- Endpoints and methods
- Request format and parameters
- Response format and codes
- Authentication requirements
- Rate limits
- Error responses

**For Configuration:**

- Setting names
- Valid values and types
- Default values
- Scope and applicability
- Dependencies and interactions

### Warnings and Constraints

Include appropriate warnings about:

- **Requirements**: Prerequisites, dependencies
- **Restrictions**: What cannot be done
- **Limitations**: Boundaries and constraints
- **Deprecated features**: Status and migration paths
- **Breaking changes**: Version-specific behavior

## Structure and Organization

### Logical Hierarchy

- Organize by component, not by use case
- Follow the product's internal organization
- Group related items together
- Use consistent navigation patterns

### Findability

- Make information easy to locate
- Use clear, predictable headings
- Provide navigation aids (TOC, search, cross-references)
- Link related items

### Completeness

- Document **everything** in the public API
- Include all parameters, options, and configurations
- Don't omit things because they "should be obvious"
- Cover edge cases and special behaviors

## Metaphors and Models

### Map Analogy

Reference functions like a **map**:

- Conveys necessary information about territory
- Users don't need to verify it firsthand
- Provides authoritative information
- Users consult it during their journey

### Food Packaging Label

Like nutrition labels:

- Presents information in standardized, lawful format
- Never mixes marketing with factual content
- Users know exactly where to find specific information
- Consistency enables quick scanning

## Common Mistakes to Avoid

1. **Mixing in Instructions**
   - Don't include "how to" steps
   - Link to how-to guides instead

2. **Including Explanations**
   - Don't explain why things work this way
   - Link to explanation documentation instead

3. **Marketing Language**
   - Avoid subjective claims
   - Stick to objective facts

4. **Inconsistent Structure**
   - Maintain the same format throughout
   - Don't reorganize by user needs

5. **Incomplete Coverage**
   - Document everything, not just common cases
   - Include all parameters and options

6. **Opinion and Recommendation**
   - Don't tell users what they should do
   - Present facts, not guidance

## When to Write Reference

Write reference documentation for:

- APIs, functions, methods, and classes
- Commands and their options
- Configuration settings
- Data structures and formats
- Error codes and messages
- Technical specifications

## When NOT to Write Reference

Don't use reference format for:

- Teaching concepts (use tutorials)
- Guiding through tasks (use how-to guides)
- Explaining design decisions (use explanation)
- Getting started experiences (use tutorials)

## Checklist for Writing Reference

- [ ] Uses neutral, objective language
- [ ] Describes what things are and do, not how to use them
- [ ] Structure mirrors the product's internal organization
- [ ] Follows consistent patterns throughout
- [ ] Includes all parameters, options, and configurations
- [ ] Provides brief usage examples
- [ ] Contains appropriate warnings and constraints
- [ ] No instructions, explanations, or opinions
- [ ] Easy to scan and find specific information
- [ ] Complete coverage of public API/interface
- [ ] Cross-references to related items
- [ ] Links to tutorials, how-to guides, and explanation as needed
