---
description: Dehallucinate GenAI-drafted docs, backing every code sample with a test, fixing the prose tells, then dropping the warning banner
argument-hint:
  [.md page OR a folder, e.g. src/docs/guides/projections.md or src/docs/guides]
---

Dehallucinate the docs at: **$ARGUMENTS**

Resolve the target first:

- **No argument** → search all of `src/docs`: `grep -rl "We created this page with the help of the GenAI tool" src/docs`. List the matches and ask which to do.
- **A folder** → search only under it (`grep -rl "We created this page with the help of the GenAI tool" $ARGUMENTS`), then dehallucinate every banner-carrying page it finds, one at a time. Report the list you found before starting, and after each page confirm before moving to the next.
- **A single `.md` file** → dehallucinate just that page.

Only touch pages that still carry the banner below; skip any that don't.

Apply to any page carrying this banner:

```
::: warning
We created this page with the help of the GenAI tool.

We're currently double-checking it to ensure the information is 100% correct and free of hallucinations.
:::
```

Worked reference: `git diff fd54391b HEAD -- src/docs/guides/projections.md`.

**Golden rule: never trust code or an API name on the page. Grep `src/packages/**` for every function, option, and property before keeping it.\*\*

**Ask before you fix.** This is dehallucination, not a rewrite from confidence. Whenever you're unsure (an API you can't find in source, a scenario you can't tell is real, a claim you can't verify, an ambiguous intent), stop and write it down. Collect the open questions and concerns and bring them to me _before_ changing anything. Don't guess and don't invent a replacement for something you couldn't confirm.

## Two jobs: correctness _and_ shape

Swapping fake code for tested snippets is only half the work. A GenAI page is usually also **shaped wrong**: an API dump with filler headings, no "why", machine-POV prose, and oversell. Fix both, or expect several rounds of "wtf is this style".

Before restructuring, load the **`docs-writer`** skill (`.claude/skills/docs-writer.md`) and follow its Diátaxis guidance. Read the page's front-matter `documentationType`, then match a sibling of the _same_ type before you touch it:

- **reference** (neutral, precise, complete): `decider.md`, `eventstore.md`.
- **how-to-guide** (problem-first, narrative): `guides/projections.md`, `getting-started.md`.

Keep the page inside its type. A reference stays neutral and doesn't become a tutorial.

## Step 1: Every code block becomes a snippet backed by a test

Inline ` ```ts ` blocks on these pages are likely hallucinated. Don't edit them in place; replace each with a transclusion of _real, executed_ code.

**Source snippets from real tests, in this priority order:**

1. **The package's own test (`src/packages/**/*.spec.ts`) is the first choice.** The behaviour a reference page documents is almost always already tested next to the implementation (e.g. `CommandHandler`in`packages/emmett/src/commandHandling/handleCommand.unit.spec.ts`). Wrap the illustrative lines of an existing test in `// #region name`/`// #endregion name` and transclude. If a scenario the page needs is *missing\*, **add it to that package spec** as a real test (TDD) and wrap its region; don't recreate the behaviour elsewhere.
2. **A `docs/snippets/**`spec, only for genuinely doc-only code.** Use this when the snippet is an *assembly built for the page* that no package test covers: a wiring example combining several packages (e.g. a`CommandHandler` + Express ETag endpoint), or getting-started narrative code. Keep the snippets folder for things that exist **just for the docs**, never a second copy of behaviour the package already tests.

Transclude with `<<< @/snippets/<area>/<file>.spec.ts#region-name` (docs snippets) or a relative path such as `<<< @./../packages/emmett/src/.../foo.unit.spec.ts#region-name` (package specs).

**VitePress dedents transcluded regions** (it strips the common leading whitespace, verified in `vitepress/dist/node`'s `dedent()`), so a `#region` wrapped inside a nested `describe`/`it` body renders clean at the left margin. Place markers around just the illustrative call and leave the test's `assert…` lines _outside_ the region so the snippet stays minimal while the surrounding test still proves it.

**The snippet must show the concept, not hide it behind a call.** If the point is "a decision returns one event vs many", the transcluded lines have to show the decision's _return shape_, not just `handle(store, id, decide)`. Wrap the decision function too, or pick a region that reveals the type. And use meaningful examples: `[addProductItem, confirm]`, never `[addProductItem, addProductItem]`.

**Put warnings in the code as comments.** A `// ❌ Avoid: …` line belongs inside the test region so it renders in the snippet, not floating as prose in the markdown around it.

**Fallback: a standalone `.snippet.ts`** beside the page (`guides/foo/name.snippet.ts`) only when a real test would blur the snippet (assertions/setup drowning the concept). Even then, confirm a test covers the scenario first; if not, add it. Structure: `/* eslint-disable @typescript-eslint/no-unused-vars */` + imports + type setup above the region, shown code inside `#region`.

One region = one concept. Never point two explanations at the same region (the old page reused `#multi-stream-projection` twice, the bug to avoid). Highlight lines that matter: `#region{2,4}` (region-relative, marker line excluded).

## Step 2: Fix the prose tells

- **Symmetric Pros/Cons lists** become prose: _"Use X when… The tradeoff is…"_. They hide the most wrong claims (old page: "Enable batching of operations", "Simpler mental model").
- **Vague generic lines** get a concrete number/example, or get cut. Fixed page: _"a shopping cart might have 10-50 events… thousands of streams on every page load."_
- **Blanket recommendations** become conditional on the real cause.
- **Generic numbered troubleshooting checklists** become one causal paragraph each: symptom, why, specific fix.
- Cut hype. Straightforward language.

### Voice: write for the reader, verify every claim

These are the rejections that cost the most rounds. Get them right the first time.

See also docs-writer skill for more information.

- **No em-dashes. Ever.** Use a colon, comma, parentheses, or semicolon. Fix the ones already on the page too.
- **No colloquialisms or slang:** not "feed into", "got there first", "hits", "pass nothing", "spread from". Say plainly what happens.
- **No strawman motivations.** Don't invent a fake problem or scenario to justify a feature. Ground every "why" in a real use (an ETag round-trip, a business-id vs stream-name split) or cut it.
- **No implementation trivia** the reader can't act on: "it's a factory", "keeps no state".
- **Reader's POV, not the machine's:** describe what the caller gets, not "while aggregating".
- **Verify the concept, not just the API name.** Read the source before asserting behaviour. It _keeps_ the version (not "records"); a command is an _intention_, the business logic decides, the events are the _outcome_ (never "turns a command into events"). A wrong mental model reads worse than a wrong function name.

## Step 3: Structure to the page's Diátaxis type

- **Headings match the type.** A reference uses the neutral nouns its siblings use (`Overview`, `Type Definitions`, `Basic Usage`, `Error Handling`, `Best Practices`, `See Also`), not imperatives, and never filler verbs ("Understand what it automates"). A how-to guide uses task imperatives ("Query Read Models"). Prefer auto-slugs; add explicit `{#anchor}`s only when you need to link to a slug the heading wouldn't produce.
- **Overview = what it is, then why use it, then how it fits.** Open with a one-line definition, then the problem it solves and when to reach for it, then how it builds on the other pieces and the more-structured alternative. No code block here; the tested Basic Usage snippets follow.
- **Options and results go in tables**, one row per property (name, type, description), not prose.
- **Best Practices:** `## Best Practices {#best-practices}`, then one `### Title Case {#best-practices-<slug>}` per practice (prefix each anchor with the section). Every practice carries a snippet or a link to where it's shown, never bare prose. Use a ✅/❌ pair only where the contrast _is_ the lesson; elsewhere use plain causal prose.
- **Link, don't transclude, full type sources.** A "Type Source" section links to the file on GitHub (`.../blob/main/src/packages/...`); don't paste the whole signature block onto the page.
- Merge "Further Reading" + "See Also"; open every link, drop dead ones; add the reciprocal links the docs-writer cross-reference matrix expects (e.g. command ↔ command-handler).
- British spelling: behaviour, authorisation, serialisation.

## Step 4: Finish

Run from `src/`, fix everything before moving on, and never leave a red build:

```
npm run build:ts   # tsc -b, catches hallucinated APIs
npm run fix        # eslint + prettier autofix
npm run test       # unit + int + e2e
npm run docs:build # confirms every transclusion #region resolves
```

Remove the `::: warning` banner only after all four are clean and every API claim is source-verified.
