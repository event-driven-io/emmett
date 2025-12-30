# Documentation Generation & Maintenance

> Generate and maintain `/src/docs/` synchronized with package READMEs, blog articles, and codebase.

## When to Use

- New feature added to any package
- Package README updated (triggers doc sync)
- New blog article published on event-driven.io
- API changes in source code
- Documentation audit requested
- VitePress build errors
- FAQ update requested (GitHub issues review)

---

## Source of Truth Hierarchy

Documentation should flow from these sources in priority order:

| Priority | Source | Location | What It Provides |
|----------|--------|----------|------------------|
| 1 | Source Code | `src/packages/*/src/**/*.ts` | Type definitions, function signatures, actual behavior |
| 2 | Package READMEs | `src/packages/*/README.md` | Installation, quick start, API reference |
| 3 | Blog Articles | `https://event-driven.io/en/` | Concepts, tutorials, best practices |
| 4 | GitHub Issues | `github.com/event-driven-io/emmett/issues` | Common problems, workarounds, FAQ content |
| 5 | Existing Docs | `src/docs/**/*.md` | Structure, navigation, cross-references |

**Golden Rule:** If source code and documentation conflict, source code wins.

---

## Documentation Types (Diataxis Framework)

| Type | Purpose | Tone | Examples in Emmett |
|------|---------|------|-------------------|
| **Tutorial** | Learning-oriented | Warm, guiding | `getting-started.md` |
| **How-to Guide** | Task-oriented | Direct, practical | `guides/*.md` |
| **Reference** | Information-oriented | Neutral, precise | `api-reference/*.md` |
| **Explanation** | Understanding-oriented | Thoughtful | `guides/choosing-event-store.md` |

---

## Sync Workflow

### Phase 1: Detect Changes

Check for documentation triggers:

```bash
# Check for README changes (from readme-writer)
git diff --name-only HEAD~10 | grep 'README.md'

# Check for source code changes
git diff --name-only HEAD~10 | grep 'src/packages/.*/src/'

# Check for new exports
for pkg in src/packages/*/; do
  diff <(git show HEAD~10:"$pkg/src/index.ts" 2>/dev/null) "$pkg/src/index.ts" 2>/dev/null
done
```

### Phase 2: Gather Sources

#### 2.1 Fetch Latest Blog Articles

```bash
# Primary article source
curl -s "https://event-driven.io/en/category/" | grep -oP 'href="/en/[^"]+' | head -20
```

**Key article categories to monitor:**

| Category | URL Pattern | Doc Impact |
|----------|-------------|------------|
| Emmett core | `/en/introducing_emmett/` | Overview, concepts |
| PostgreSQL | `/en/emmett_postgresql*/` | `event-stores/postgresql.md` |
| Projections | `/en/emmett_projections*/` | `guides/projections.md` |
| Testing | `/en/testing_event_sourcing*/` | `guides/testing.md` |
| Workflows | `/en/workflow*/` | `guides/workflows.md` |
| Consumers | `/en/emmett_consumers*/` | `guides/projections.md` |
| Pongo | `/en/pongo*/` | PostgreSQL docs |

#### 2.2 Read Package READMEs

```bash
# All package READMEs
for readme in src/packages/*/README.md; do
  echo "=== $readme ==="
  cat "$readme"
done
```

#### 2.3 Read Source Types

```bash
# Core type definitions
cat src/packages/emmett/src/typing/*.ts
cat src/packages/emmett/src/eventStore/*.ts
cat src/packages/emmett/src/commandHandling/*.ts
cat src/packages/emmett/src/projections/*.ts
```

### Phase 3: Validate & Update

For each documentation file, run these checks:

---

## Validation Rules by Doc Type

### API Reference (`api-reference/*.md`)

```
□ Type signatures match source code exactly
□ All exported functions documented
□ All exported types documented
□ Code examples compile (mentally verify imports)
□ Links to related docs exist
□ "See Also" section current
```

**Update triggers:**
- New export in `src/packages/emmett/src/index.ts`
- Type signature changed
- New package released

### Guides (`guides/*.md`)

```
□ Code examples use current API
□ Import paths valid
□ Concepts align with blog articles
□ Testing patterns match current test utilities
□ Links to API reference accurate
```

**Update triggers:**
- Blog article with new pattern published
- Testing utilities changed
- New best practice identified

### Event Store Docs (`event-stores/*.md`)

```
□ Installation commands match package.json
□ Connection setup current
□ Projection examples use correct API
□ Consumer setup accurate
□ Feature comparison table current
```

**Update triggers:**
- Package README updated
- New feature added to event store
- Dependency version changed

### Framework Docs (`frameworks/*.md`)

```
□ Integration setup matches package
□ Response helpers documented
□ Testing utilities current
□ Error handling accurate
```

**Update triggers:**
- Express.js or Fastify package changes
- New middleware added
- Error types changed

---

## Code Example Standards

### Import Validation

Every code example must have valid imports:

```typescript
// ✅ Good: Import from actual package
import { Event, Command } from '@event-driven-io/emmett';
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';

// ❌ Bad: Import from internal path
import { Event } from '../typing';
```

### Example Completeness

```typescript
// ✅ Good: Self-contained, runnable
import { Event, CommandHandler } from '@event-driven-io/emmett';

type ProductItemAdded = Event<'ProductItemAdded', { productId: string }>;

const handler = CommandHandler({
  evolve: (state, event) => state,
  initialState: () => ({}),
});

// ❌ Bad: Missing context
const handler = CommandHandler({ evolve, initialState }); // Where are these defined?
```

### Expected Output Comments

```typescript
// ✅ Good: Show what happens
const result = await eventStore.readStream('cart-123');
console.log(result.events.length); // → 5
console.log(result.streamExists);  // → true

// ❌ Bad: No indication of result
const result = await eventStore.readStream('cart-123');
```

---

## Cross-Reference Matrix

When updating one doc, check these related docs:

| When You Update | Also Check |
|-----------------|------------|
| `api-reference/event.md` | `getting-started.md`, `api-reference/decider.md` |
| `api-reference/command.md` | `api-reference/commandhandler.md`, `api-reference/decider.md` |
| `api-reference/eventstore.md` | All `event-stores/*.md` files |
| `api-reference/decider.md` | `guides/testing.md`, `api-reference/commandhandler.md` |
| `api-reference/projections.md` | `guides/projections.md`, all `event-stores/*.md` |
| `guides/testing.md` | `api-reference/decider.md`, framework docs |
| `guides/projections.md` | `api-reference/projections.md`, `event-stores/postgresql.md` |
| `guides/workflows.md` | `api-reference/workflows.md` |
| `event-stores/postgresql.md` | `guides/projections.md`, `guides/choosing-event-store.md` |
| Any event store doc | `event-stores/index.md`, `guides/choosing-event-store.md` |

---

## Blog Article Integration

### Extracting Concepts from Articles

When a new blog article is published:

1. **Read the article** via WebFetch
2. **Identify new concepts** not in current docs
3. **Extract code examples** that improve docs
4. **Update relevant doc files**

### Article-to-Doc Mapping

| Article Topic | Target Doc(s) | Action |
|---------------|---------------|--------|
| New Emmett feature | `api-reference/*.md` | Add API docs |
| PostgreSQL patterns | `event-stores/postgresql.md`, `guides/projections.md` | Update patterns |
| Testing techniques | `guides/testing.md` | Add examples |
| Workflow patterns | `guides/workflows.md` | Add use cases |
| Projection patterns | `guides/projections.md` | Add techniques |
| Error handling | `guides/error-handling.md` | Add patterns |
| Pongo updates | `event-stores/postgresql.md` | Update Pongo section |

### Article Fetch Template

```
Fetch: https://event-driven.io/en/{article-slug}/

EXTRACT:
1. New concepts introduced
2. Code examples (verify they compile)
3. Best practices mentioned
4. Patterns described
5. Warnings/gotchas

MAP TO:
- Which existing doc file(s) should be updated?
- Is a new doc file needed?
- Are code examples more current than docs?
```

---

## GitHub Issues → FAQ Generation

Periodically review GitHub issues to build and update `resources/faq.md`.

### When to Update FAQ

- Monthly audit
- Major version release
- Spike in similar issues
- Issue marked as resolved with workaround

### Fetching Issues

```bash
# Get all issues with full details
gh issue list --limit 100 --state all --json number,title,body,labels,state,comments,createdAt

# Get issue summary
gh issue list --limit 50 --state all --json number,title,labels,state | \
  jq -r '.[] | "#\(.number) [\(.state)] \(.title) - Labels: \(.labels | map(.name) | join(", "))"'
```

### Issue Analysis Process

1. **Fetch all issues** (open and closed)
2. **Categorize by topic:**

| Category | Label Patterns | FAQ Section |
|----------|---------------|-------------|
| Installation | `bug`, `compatibility` | Installation & Setup |
| Event Store | `event store`, `PostgreSQL`, `mongodb`, `SQLite` | Event Store |
| Projections | `projections` | Projections |
| Testing | `testing` | Testing |
| TypeScript | `typing`, `bug` | Installation & Setup |
| Consumers | `consumers` | EventStoreDB / MongoDB |

3. **Extract FAQ content from issues:**

```
FOR EACH issue:
  - Problem: Issue title + body description
  - Solution: Comments from maintainers OR fix version
  - Status: OPEN (workaround) or CLOSED (fixed in version X)
  - Related Issue: Link to GitHub issue
```

### FAQ Entry Format

```markdown
### {Question as title}

**Problem:** {Description from issue body}

**Solution:** {From maintainer comments or fix}

\`\`\`typescript
// Code example if applicable
\`\`\`

*Related: [GitHub Issue #{number}](https://github.com/event-driven-io/emmett/issues/{number})*
```

### FAQ Section Organization

```markdown
# Frequently Asked Questions

## General
- What is Emmett?
- Which event stores does Emmett support?
- Can I use Emmett without the Command Handler?

## Installation & Setup
- TypeScript build errors
- Express v5 support
- TestContainers with Podman

## Event Store
- Events returned in wrong order (FIXED)
- PostgreSQL schema configuration
- Configuration options

## Projections
- Handler receives only last event (expected behavior)
- Testing projections
- Replay from point in time

## {Database}-Specific
- MongoDB ObjectId issues
- EventStoreDB subscription drops

## Testing
- Deep equals type coercion
- Test isolation

## Compatibility
- Vercel/Supabase support
- Browser usage
```

### Issue-to-FAQ Mapping

| Issue Pattern | FAQ Entry Type |
|---------------|----------------|
| Bug + CLOSED | "This was fixed in version X" |
| Bug + OPEN | "Workaround: ..." |
| Enhancement + OPEN | Omit or mention as planned |
| Question in issue | Direct FAQ entry |
| Documentation request | Update relevant doc instead |

### FAQ Quality Rules

```
□ Each answer has a clear problem statement
□ Solutions include code examples where applicable
□ Fixed issues mention the version with fix
□ Open issues provide workarounds
□ Links to related GitHub issues included
□ No duplicate entries
□ Organized by user journey (setup → usage → advanced)
```

### Maintenance Commands

```bash
# Find issues closed in last 30 days (potential FAQ updates)
gh issue list --state closed --json number,title,closedAt | \
  jq '[.[] | select(.closedAt > (now - 2592000 | todate))]'

# Find most commented issues (high community interest)
gh issue list --state all --json number,title,comments | \
  jq 'sort_by(.comments | length) | reverse | .[0:10]'

# Find issues by label
gh issue list --label "bug" --state all --json number,title,state
```

---

## README-to-Docs Sync

When a package README is updated (by readme-writer):

### 1. Identify Changed Sections

```bash
git diff src/packages/{package}/README.md
```

### 2. Map README Sections to Docs

| README Section | Doc Target |
|----------------|------------|
| Quick Start | `event-stores/{package}.md` → Quick Start |
| Installation | `event-stores/{package}.md` → Installation |
| API Reference | `api-reference/*.md` |
| Projections | `guides/projections.md`, `event-stores/{package}.md` |
| Testing | `guides/testing.md` |
| Configuration | `event-stores/{package}.md` |

### 3. Sync Content

**Rules:**
- Docs should be MORE detailed than README
- Docs can add context README lacks
- Docs should cross-reference other docs
- README quick start → Docs quick start (may be identical)
- README API → Docs API (docs add more examples)

---

## VitePress-Specific Rules

### File Organization

```
src/docs/
├── .vitepress/
│   └── config.mts          # Navigation, sidebar (keep synced!)
├── api-reference/
│   ├── index.md            # API landing page
│   ├── event.md
│   ├── command.md
│   ├── eventstore.md
│   ├── commandhandler.md
│   ├── decider.md
│   ├── projections.md
│   └── workflows.md
├── event-stores/
│   ├── index.md            # Comparison page
│   ├── postgresql.md
│   ├── esdb.md
│   ├── mongodb.md
│   └── sqlite.md
├── frameworks/
│   ├── expressjs.md
│   └── fastify.md
├── guides/
│   ├── projections.md
│   ├── testing.md
│   ├── error-handling.md
│   ├── workflows.md
│   └── choosing-event-store.md
├── resources/
│   ├── articles.md
│   ├── packages.md
│   ├── faq.md              # Generated from GitHub issues
│   └── contributing.md
├── samples/
│   └── index.md
├── snippets/               # Code snippets for embedding
│   └── **/*.ts
├── getting-started.md
├── overview.md
└── quick-intro.md
```

### Frontmatter Requirements

Every doc file must have:

```yaml
---
documentationType: reference | how-to-guide | tutorial | explanation
outline: deep
---
```

### Code Snippet Embedding

Use VitePress code snippet syntax:

```markdown
<<< @/snippets/api/event.ts#event-type
```

This requires a corresponding file with region markers:

```typescript
// #region event-type
import type { Event } from '@event-driven-io/emmett';

type ProductItemAdded = Event<'ProductItemAdded', { productId: string }>;
// #endregion event-type
```

### Internal Links

```markdown
<!-- ✅ Good: Root-relative paths -->
[Event API](/api-reference/event)
[PostgreSQL](/event-stores/postgresql)

<!-- ❌ Bad: File extensions -->
[Event API](/api-reference/event.md)

<!-- ❌ Bad: Relative paths that may break -->
[Event API](../api-reference/event)
```

---

## Sidebar Sync

When adding new docs, update `.vitepress/config.mts`:

```typescript
sidebar: [
  {
    text: 'Section Name',
    items: [
      { text: 'Doc Title', link: '/path/to/doc' },
      // Add new docs here
    ],
  },
],
```

**Validation:**
```
□ Every .md file in docs/ has a sidebar entry
□ Every sidebar link points to existing file
□ Order reflects learning progression
□ Collapsed sections for advanced topics
```

---

## Update Workflow

### When Package Code Changes

1. Read changed source files
2. Compare with API reference docs
3. Update type signatures if changed
4. Update examples if API changed
5. Verify all imports still valid

### When README Changes

1. Diff the README
2. Map changed sections to docs
3. Update corresponding doc sections
4. Ensure docs have MORE detail than README
5. Add cross-references if missing

### When Blog Article Published

1. Fetch article content
2. Identify new concepts/patterns
3. Check if existing docs cover this
4. Update or add doc content
5. Add article to `resources/articles.md`

### When Doc Requested

1. Determine doc type (Diataxis)
2. Identify source materials
3. Follow appropriate template
4. Validate code examples
5. Add to sidebar
6. Cross-reference related docs

### When FAQ Update Requested

1. Fetch GitHub issues via `gh issue list`
2. Categorize issues by topic/label
3. Extract problems and solutions from issue threads
4. Update `resources/faq.md` with new entries
5. Link each FAQ entry to relevant GitHub issue
6. Remove outdated entries (issues resolved differently)
7. Verify sidebar includes FAQ link

---

## Quality Checklist

### Before Committing Doc Changes

```
□ All code examples have valid imports
□ All code examples are self-contained
□ Type signatures match source code
□ Internal links resolve to existing files
□ Sidebar updated if new file added
□ Frontmatter present and correct
□ No broken external links
□ Examples show expected output
□ Cross-references to related docs
□ Follows Diataxis documentation type
```

### Periodic Audit (Monthly)

```
□ All package README changes reflected in docs
□ New blog articles integrated
□ API reference matches current exports
□ Code examples still compile
□ External links still work
□ Comparison tables current
□ Version numbers not hardcoded (or current)
□ FAQ updated with recent GitHub issues
□ Closed issues with fixes noted in FAQ
```

---

## Anti-Patterns to Avoid

| Pattern | Problem | Fix |
|---------|---------|-----|
| Duplicate content | Maintenance burden | Single source, link elsewhere |
| Hardcoded versions | Goes stale | Remove or use dynamic |
| Internal import paths | Confuses users | Use package imports |
| Missing imports | Can't copy-paste | Add all imports |
| "See README" | Forces navigation | Inline relevant content |
| Outdated examples | Misleads users | Sync with source |
| Dead links | Broken experience | Verify all links |
| Marketing language | Erodes trust | Be factual |

---

## Template: New API Reference Page

```markdown
---
documentationType: reference
outline: deep
---

# {Concept Name}

{One sentence description of what this is.}

## Overview

{2-3 paragraphs explaining:}
- What problem this solves
- When to use it
- How it fits with other concepts

## Type Definition

\`\`\`typescript
{Actual type from source code}
\`\`\`

| Property | Type | Description |
|----------|------|-------------|
| ... | ... | ... |

## Basic Usage

\`\`\`typescript
import { ... } from '@event-driven-io/emmett';

// Example with expected output
\`\`\`

## {Common Pattern 1}

\`\`\`typescript
{Example}
\`\`\`

## {Common Pattern 2}

\`\`\`typescript
{Example}
\`\`\`

## Best Practices

### 1. {Practice 1}

\`\`\`typescript
// ✅ Good
{good example}

// ❌ Bad
{bad example}
\`\`\`

## See Also

- [Related Doc 1](/path/to/doc1) - {why it's related}
- [Related Doc 2](/path/to/doc2) - {why it's related}
```

---

## Template: New Guide Page

```markdown
---
documentationType: how-to-guide
outline: deep
---

# {Task Name}

{One sentence: what this guide helps you accomplish.}

## Overview

{Brief context: when you'd need this, what problem it solves}

## Prerequisites

- {Prerequisite 1}
- {Prerequisite 2}

## Step 1: {First Step}

\`\`\`typescript
{Code for step 1}
\`\`\`

{Explanation of what this does}

## Step 2: {Second Step}

\`\`\`typescript
{Code for step 2}
\`\`\`

## {Variation/Advanced Topic}

{Additional patterns or advanced usage}

## Common Pitfalls

### {Pitfall 1}

**Problem:** {description}

**Solution:**
\`\`\`typescript
{fix}
\`\`\`

## See Also

- [Related Guide](/guides/related) - {context}
- [API Reference](/api-reference/relevant) - {context}
```

---

## Template: Event Store Page

```markdown
---
documentationType: reference
outline: deep
---

# {Database} Event Store

{Package name} for Emmett providing {key benefit}.

## Overview

{When to use this event store}

| Aspect | Details |
|--------|---------|
| Package | `@event-driven-io/emmett-{name}` |
| Production Ready | Yes/No |
| Inline Projections | Yes/No |
| Async Consumers | Yes/No |

## Installation

\`\`\`bash
npm install @event-driven-io/emmett-{name}
\`\`\`

## Quick Start

\`\`\`typescript
{Minimal working example}
\`\`\`

## Configuration

\`\`\`typescript
{Configuration options with comments}
\`\`\`

## Projections

{Projection patterns specific to this store}

## Testing

{Testing setup with this store}

## Full Package Documentation

For complete API reference, see the [package README](https://github.com/event-driven-io/emmett/tree/main/src/packages/emmett-{name}).

## See Also

- [Choosing an Event Store](/guides/choosing-event-store)
- [Projections Guide](/guides/projections)
```

---

## Maintenance Commands

```bash
# Verify all internal links
grep -roh '\](/[^)]*' src/docs/*.md src/docs/**/*.md | sort | uniq

# Find docs without frontmatter
for f in src/docs/**/*.md; do
  head -1 "$f" | grep -q '^---' || echo "Missing frontmatter: $f"
done

# List all docs not in sidebar
# (manual comparison with config.mts)

# Find hardcoded versions
grep -rn '[0-9]\+\.[0-9]\+\.[0-9]\+' src/docs/**/*.md

# Check for dead external links
grep -roh 'https://[^)]*' src/docs/**/*.md | sort | uniq
```
