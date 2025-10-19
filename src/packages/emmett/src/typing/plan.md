# TDD Plan: Implement URN Runtime System

## Problem

`OrgURN` was evaluating to `never` instead of `urn:org:${string}` - FIXED in Steps 1-16.
Now implementing runtime support for URN creation, validation, and manipulation.

## Development Setup

```bash
# Start agents for continuous building and linting
cd src

# Agent 1: TypeScript watch
npm run build:ts:watch

# Agent 2: Linting fix and check
npm run fix

# Agent 3: testing watch
npm run test:unit:watch
```

## TDD Workflow

1. RED: Write failing test
2. GREEN: Implement minimum code to pass
3. REFACTOR: Improve and add comprehensive tests
4. COMMIT: Commit with concise message

When you're unsure how to fix something YOU MUST STOP AND ASK.

YOU MUST ask for approval before commiting the fix.

## Phase 1: Type System Enhancement (COMPLETED)

✅ Steps 1-16: Fixed `PatternToTemplate` bug for multi-element patterns

## Phase 2: Runtime Implementation

### Step 17: Create URN builder functions (RED)

Write tests in new `urn.unit.spec.ts`:

YOU MUST READ src/packages/emmett/src/taskProcessing/taskProcessor.unit.spec.ts and check for conventions and follow the same structure and assertions code.

- Test segment() returns SegmentSchema with type: 'segment'
- Test segments() returns SegmentsSchema with type: 'segments'
- Test literal() returns LiteralSchema with type: 'literal' and value
- Test urnSchema() combines namespace and pattern array

### Step 18: Implement builders (GREEN)

Add NEW functions to `urn.ts`:

- `segment<T>()` - creates single segment schema
- `segments<T>()` - creates multi-segment schema
- `literal<T>(value)` - creates literal schema with value
- `urnSchema(namespace, pattern)` - creates URN schema

### Step 19: Add validation tests (RED)

Test URN string validation:

- Correct namespace prefix (`urn:org:` for org namespace)
- Wrong namespace rejection
- Empty pattern validation (just `urn:namespace:`)
- Single segment matching
- Literal value matching
- Segments consuming rest of string

### Step 20: Implement defineURN with validation (GREEN)

Create `defineURN(schema)` that returns object with:

- `schema` property
- `validate(string): boolean` type guard method
  Fix segment vs segments parsing bug from commented code

### Step 21: Test URN creation with basic types (RED)

Test creating URNs:

- No arguments for empty pattern
- Single argument for single segment
- Multiple arguments for segments
- Literals auto-inserted (not passed as args)

### Step 22: Implement basic create method (GREEN)

Add `create(...args)` to defineURN result.
Start with simple implementation, improve types later.

### Step 23: Test URN parsing (RED)

NEW feature - parse URN strings back to values:

- Extract single segment value
- Extract literal positions
- Extract multiple segments
- Return typed tuple or object

### Step 24: Implement parse method (GREEN)

Add `parse(urn)` method that extracts values based on pattern.
Returns structured data matching the pattern.

### Step 25: Test hierarchy operations (RED)

Test parent/child relationships:

- `isParent(parent, child)` - direct parent only
- `isAncestor(ancestor, descendant)` - any level
- `getParent(urn)` - extract parent URN or null
- `getAncestors(urn)` - list all ancestors (NEW)

### Step 26: Implement hierarchy methods (GREEN)

Add hierarchy methods using string operations.
Count colons and slice strings appropriately.

### Step 27: Test URN composition (RED)

Test extending URN patterns:

- Extend segments pattern with literal and segment
- Preserve namespace
- New pattern validates combined structure
- Create works with extended pattern

### Step 28: Implement extend method (GREEN)

Create `extend(baseURN, additionalPattern)` function.
Returns new URN definition with combined pattern.
Ensure proper type inference (no `any`).

### Step 29: Add validator tests (RED)

Test custom validation functions:

- Digit-only validator for IDs
- UUID format validator
- Length constraints
- Business rule validators
- Validators on segments (each part validated)

### Step 30: Implement validator support (GREEN)

Update segment/segments functions to accept validators.
Call validators during validate() and create().
Add clear error reporting.

### Step 31: Type-safe create arguments (RED)

Test that create() has proper types:

- Correct argument count based on pattern
- Type checking when validator implies type
- Compile errors for wrong arguments

### Step 32: Implement typed create (GREEN/REFACTOR)

Use conditional types to infer arguments from pattern.
May need function overloads or complex generics.
Balance type safety with usability.

### Step 33: Integration tests (RED)

Real-world URN examples:

```typescript
// Organization: urn:org:acme:emea
const orgURN = defineURN(urnSchema('org', [segments()]));

// Team: urn:org:acme:team:engineering
const teamURN = defineURN(
  urnSchema('org', [segments(), literal('team'), segments()]),
);

// User: urn:user:{uuid}
const userURN = defineURN(urnSchema('user', [segment(isUUID)]));

// Task: urn:project:web:task:123
const taskURN = defineURN(
  urnSchema('project', [segment(), literal('task'), segment(isNumber)]),
);
```

### Step 34: Performance and optimization (REFACTOR)

- Cache pattern compilation
- Optimize string operations
- Reduce allocations
- Add benchmarks

### Step 35: Error handling and debugging (REFACTOR)

- Add detailed validation error messages
- Include pattern position in errors
- Add debug mode for tracing
- Validate schema construction

### Step 36: Final cleanup

- Remove ALL commented code from urn.ts
- Organize exports (public API only)
- Add JSDoc documentation
- Format and lint all files
- Update this plan.md with "COMPLETED"

## Implementation Files

- `urn.ts`: Type definitions and runtime implementation (NO commented code)
- `urn.types.spec.ts`: Type-level tests
- `urn.unit.spec.ts`: Runtime unit tests using node:test
- `test-utils.ts`: Testing utilities

## Key Improvements Over Commented Code

1. **Type Safety**: Proper type inference for create() arguments
2. **Parse Method**: Extract values from URN strings (NEW)
3. **Better Validation**: Fix segment/segments bug, clear errors
4. **Clean Architecture**: Fresh implementation, not uncommented
5. **Extended Features**: Ancestors list, debug mode, benchmarks

## Success Criteria

- All type tests pass
- All unit tests pass
- No TypeScript errors
- No commented code remains
- Better than original implementation
