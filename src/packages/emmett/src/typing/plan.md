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

## Steps 10+: Nested Pattern Tests (IN PROGRESS)

Testing patterns with multiple elements to find the bug.

### Step 10: Literal After Segments (Team Pattern)
Pattern: `[{type: 'segments'}, {type: 'literal', value: 'team'}, {type: 'segments'}]`
Expected: `urn:org:${string}:team:${string}`

This tests:
- Recursive Rest processing
- Switching between segments and literal types
- Colons between pattern elements

### Step 11: Full Recursive Pattern Transformer
Implement recursive `PatternToTemplate` that handles:
- Empty array base case
- First element extraction with `infer First, ...infer Rest`
- Recursion on `Rest`
- Proper colon insertion between elements
- Different handling for `segments` (consumes all remaining)

### Step 12: Test Actual Schema-to-URN Pattern
Use actual schema objects like the original code:
```typescript
const orgSchema = { namespace: 'org', pattern: [segments()] }
const teamSchema = { namespace: 'org', pattern: [segments(), literal('team'), segments()] }
```

## Expected Bug Location

Based on Steps 1-9, the bug is likely in the **recursive Rest handling** of `PatternToTemplate`.

Specifically when:
1. First element is `{type: 'segments'}`
2. Rest is not empty (has literal or more segments)
3. The recursion doesn't handle this correctly

## Next Steps

1. Implement Step 10: Test pattern with literal after segments
2. Implement Step 11: Full recursive PatternToTemplate
3. Find exact line where type becomes `never`
4. Fix the issue
5. Verify all tests pass
