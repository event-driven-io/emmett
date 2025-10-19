# TDD Plan: Fix URN Types

## Problem

`OrgURN` was evaluating to `never` instead of `urn:org:${string}`.

## Development Setup

```bash
cd src
npm run build:ts:watch
npm run fix
```

## TDD Workflow

1. RED: Write failing test
2. GREEN: Implement minimum code to pass
3. REFACTOR: Add comprehensive tests
4. COMMIT: Commit with concise message

## Type Testing Approach

```typescript
export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

export const test1Check: Test1 = true;
```

## Steps 1-9: Basic Pattern Tests

All isolated patterns worked correctly:

- Template literals
- Single/multiple segments
- Objects with optional properties
- Array destructuring with `infer`
- Full URN pattern with single element

**Finding**: Bug was NOT in basic pattern matching.

## Steps 10-12: Multi-Element Patterns

Found the bug in `PatternToTemplate`:

**Problem**: segments case always returned `${string}` regardless of Rest content.

```typescript
: First extends { type: 'segments'; validator?: unknown }
  ? `${string}` // BUG: ignores Rest
```

## Steps 13-16: Fix

### Step 13: Update test assertions (RED)

```typescript
export type Test31 = Equals<TwoElementResult, `${string}:team`>;
export type Test33 = Equals<TeamURN, `urn:org:${string}:team`>;
```

### Step 14: Fix segments case (GREEN)

```typescript
: First extends { type: 'segments'; validator?: unknown }
  ? Rest extends readonly []
    ? `${string}`
    : `${string}:${PatternToTemplate<Rest>}`
```

### Step 15: Add comprehensive tests (REFACTOR)

Tested all pattern combinations:

- Single literal
- Multiple literals
- Literal + segments
- Segments + literal
- Segments + literal + segments

### Step 16: Apply fix to urn.ts

Applied the same fix to the original `PatternToTemplate` implementation.

## Implementation

**Files**:

- `urn.ts`: Core type definitions and PatternToTemplate implementation
- `urn.types.spec.ts`: Type tests with descriptive names testing real URN functionality
- `test-utils.ts`: Reusable type testing utilities (Equals, IsNever, IsAny, IsUnknown)
- All runtime code preserved as comments in urn.ts for future TDD implementation

**Result**: All tests pass, 0 TypeScript errors.
