# TDD Plan: Fix URN Types

## Problem Statement
`OrgURN` should be `urn:org:${string}` but it's currently `never`.
Building from simplest cases to find where the type transformation breaks.

## Development Setup

### TypeScript Watch Mode
Run in background to monitor type errors:
```bash
cd src
npm run build:ts:watch
```

### Linting
Run after each step:
```bash
cd src
npm run fix
```

### TDD Workflow: RED-GREEN-REFACTOR
1. **RED**: Write failing test (undefined types cause errors)
2. **GREEN**: Implement minimum code to pass
3. **REFACTOR**: Add comprehensive tests
4. **COMMIT**: Commit with concise message

## Type Testing Approach

Using TypeScript compiler directly with:
- Type equality checker using conditional types
- Const assertions to force type evaluation
- Runtime tests to verify template literal behavior

```typescript
// Type equality checker
export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

// Force evaluation
export const test1Check: Test1 = true; // Will error if Test1 is not true
```

## Steps 1-9: Basic Pattern Tests (COMPLETED ✓)

All tests pass! The isolated patterns work correctly:

### Step 1: Basic Template Literals ✓
- `urn:org:${string}` works correctly

### Step 2-3: Single Segment ✓
- Transform `'segment'` → `string` works
- Build `urn:${NS}:${string}` works

### Step 4: Multiple Segments ✓
- Transform `'segments'` → `string` works
- `OrgURNSimple` produces `urn:org:${string}` (NOT never)

### Step 5: Object Pattern ✓
- `{type: 'segments'}` transforms correctly

### Step 6: Optional Properties ✓
- `{type: 'segments'; validator?: ...}` works correctly

### Step 7: Arrays ✓
- `[{type: 'segments'}]` and `readonly` variants work

### Step 8: Destructuring with Infer ✓
- `readonly [infer First, ...infer _Rest]` works
- `First extends {type: 'segments'}` matches correctly
- **Even with optional properties!**

### Step 9: Full URN Pattern ✓
- Complete pattern matches original code structure
- `MakeURN<'org', readonly [SegmentsWithOpt]>` produces `urn:org:${string}`
- **NOT never!**

## Key Finding from Steps 1-9

**The isolated single-element pattern works perfectly.**

This means the bug is NOT caused by:
- Template literals
- Optional property matching
- Array destructuring with `infer`
- Basic pattern matching

The bug must be in:
- **Recursive pattern handling** (multiple elements in sequence)
- **Interaction between different pattern types** (literal + segments)
- **The Rest handling** after destructuring first element

## Steps 10-12: Nested Pattern Tests (COMPLETED - BUG FOUND)

Initial implementation revealed the bug in segments handling.

### Step 10: Transform Literal Pattern Value

**Add to `urn-scratch.ts`:**
```typescript
export type LiteralTeam = { type: 'literal'; value: 'team' };

export type TransformLiteral<T> = T extends { type: 'literal'; value: infer V }
  ? V
  : never;

export type LiteralResult = TransformLiteral<LiteralTeam>;

export type Test28 = Equals<LiteralResult, 'team'>;
export type Test29 = Equals<LiteralResult, string>;
export type Test30 = Equals<LiteralResult, never>;
```

**Result:** All tests pass ✓

### Step 11: Recursive PatternToString Implementation

**Add to `urn-scratch.ts`:**
```typescript
export type PatternToString<P> = P extends readonly []
  ? ''
  : P extends readonly [infer First, ...infer Rest]
    ? First extends { type: 'literal'; value: infer V extends string }
      ? Rest extends readonly []
        ? V
        : `${V}:${PatternToString<Rest>}`
      : First extends { type: 'segment'; validator?: unknown }
        ? Rest extends readonly []
          ? `${string}`
          : `${string}:${PatternToString<Rest>}`
      : First extends { type: 'segments'; validator?: unknown }
        ? `${string}` // BUG: This always returns, ignoring Rest!
        : never
    : never;

export type TwoElementPattern = readonly [SegmentsWithOpt, LiteralTeam];
export type TwoElementResult = PatternToString<TwoElementPattern>;
```

**Result:** Compiles, but `TwoElementResult` is `${string}` instead of `${string}:team`

### Step 12: Full URN Builder

**Add to `urn-scratch.ts`:**
```typescript
export type BuildCompleteURN<NS extends string, Pattern> =
  `urn:${NS}:${PatternToString<Pattern>}`;

export type TeamURN = BuildCompleteURN<'org', TwoElementPattern>;
```

**Result:** `TeamURN` is `urn:org:${string}` instead of `urn:org:${string}:team`

## Bug Found in Steps 10-12

**Location:** PatternToString segments case (line 314 in urn-scratch.ts)

**Current code:**
```typescript
: First extends { type: 'segments'; validator?: unknown }
  ? `${string}` // segments consumes all remaining
```

**Problem:** Always returns `${string}` regardless of Rest content, breaking recursion.

**Evidence from original urn.ts usage (line 242-244):**
```typescript
urnSchema('org', [segments(), literal('team'), segments()])
// Should produce: `urn:org:${string}:team:${string}`
// Currently produces: `urn:org:${string}` (literal and second segments ignored!)
```

**Root cause:** The comment "segments consumes all remaining" is misleading. Segments should only skip recursion if it's the last element OR if actual runtime behavior requires it.

## Steps 13-16: Fix Implementation

### Step 13: Update Test Assertions to Expect Correct Behavior

**Modify `urn-scratch.ts`:**
```typescript
// OLD (wrong):
export type Test31 = Equals<TwoElementResult, `${string}`>;
export type Test33 = Equals<TeamURN, `urn:org:${string}`>;

// NEW (correct):
export type Test31 = Equals<TwoElementResult, `${string}:team`>;
export type Test33 = Equals<TeamURN, `urn:org:${string}:team`>;
```

**Run TypeScript:** Tests should fail (RED) - this confirms the bug

### Step 14: Fix PatternToString Segments Case

**Modify `urn-scratch.ts`:**
```typescript
// Change this:
: First extends { type: 'segments'; validator?: unknown }
  ? `${string}` // segments consumes all remaining

// To this:
: First extends { type: 'segments'; validator?: unknown }
  ? Rest extends readonly []
    ? `${string}`
    : `${string}:${PatternToString<Rest>}`
```

**Run TypeScript:** All tests should pass (GREEN)

### Step 15: Add Comprehensive Multi-Element Pattern Tests

**Add to `urn-scratch.ts`:**
```typescript
// Test all pattern combinations
export type Pattern1 = readonly [LiteralTeam];
export type Result1 = PatternToString<Pattern1>; // 'team'

export type Pattern2 = readonly [{ type: 'literal'; value: 'org' }, LiteralTeam];
export type Result2 = PatternToString<Pattern2>; // 'org:team'

export type Pattern3 = readonly [{ type: 'literal'; value: 'org' }, SegmentsWithOpt];
export type Result3 = PatternToString<Pattern3>; // 'org:${string}'

export type Pattern4 = readonly [SegmentsWithOpt];
export type Result4 = PatternToString<Pattern4>; // '${string}'

export type Pattern5 = readonly [SegmentsWithOpt, LiteralTeam];
export type Result5 = PatternToString<Pattern5>; // '${string}:team'

export type Pattern6 = readonly [SegmentsWithOpt, LiteralTeam, SegmentsWithOpt];
export type Result6 = PatternToString<Pattern6>; // '${string}:team:${string}'

// Add Test35-40 with Equals checks for each
```

**Run TypeScript and verify all patterns produce correct types**

### Step 16: Apply Fix to Original urn.ts

**Modify `urn.ts` line 82-84:**
```typescript
// Change:
: First extends { type: 'segments'; validator?: unknown }
  ? `${string}` // segments consumes all remaining

// To:
: First extends { type: 'segments'; validator?: unknown }
  ? Rest extends readonly []
    ? `${string}`
    : `${string}:${PatternToTemplate<Rest>}`
```

**Verify:** OrgURN and TeamURN types are correct in original usage
