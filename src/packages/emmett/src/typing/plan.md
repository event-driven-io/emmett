# TDD Plan: Fix URN Types - Start from Single Segment

## Problem Statement
`OrgURN` should be `urn:org:${string}` but it's currently `never`.
We need to understand WHY it's failing by building from the simplest possible case.

## Testing Approach
Since tsd isn't easily usable in this setup, we'll use TypeScript's compiler directly with our own type assertions.

## How to Test Types Without tsd

We'll create type tests that:
1. Should compile without errors (positive tests)
2. Should produce specific TypeScript errors (negative tests with @ts-expect-error)
3. Use conditional types to assert type equality

## Step-by-Step Implementation

### Step 1: Test if Template Literals Work At All

**Create `urn-scratch.ts`:**
```typescript
// Test 1: Basic template literal
export type BasicTemplate = `urn:org:${string}`;

// Type equality checker
export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;

// Test that BasicTemplate is actually a template, not literal
export type Test1 = Equals<BasicTemplate, `urn:org:${string}`>; // Should be: true
export type Test2 = Equals<BasicTemplate, 'urn:org:'>; // Should be: false
export type Test3 = Equals<BasicTemplate, never>; // Should be: false

// Runtime tests (these should compile)
export const valid1: BasicTemplate = 'urn:org:acme';
export const valid2: BasicTemplate = 'urn:org:';
export const valid3: BasicTemplate = 'urn:org:a:b:c';

// These should NOT compile
// @ts-expect-error - wrong prefix
export const invalid1: BasicTemplate = 'urn:team:acme';
// @ts-expect-error - no prefix
export const invalid2: BasicTemplate = 'acme';
```

**Run:** `npx tsc --noEmit src/typing/urn-scratch.ts`
- Check that no unexpected errors appear
- Check that @ts-expect-error lines actually have errors

### Step 2: Single Segment Pattern (NOT segments!)

**Add to `urn-scratch.ts`:**
```typescript
// Transform 'segment' (single) to string type
export type TransformSegment<T> = T extends 'segment' ? string : never;

// Tests
export type SegmentResult = TransformSegment<'segment'>;
export type Test4 = Equals<SegmentResult, string>; // Should be: true
export type Test5 = Equals<SegmentResult, never>; // Should be: false

// Test wrong input
export type WrongResult = TransformSegment<'wrong'>;
export type Test6 = Equals<WrongResult, never>; // Should be: true

// Runtime test
export const seg1: SegmentResult = 'anything';
export const seg2: SegmentResult = '';
```

**Run TypeScript and verify:**
- `SegmentResult` is `string`, not `never`

### Step 3: Build URN with Single Segment

**Add to `urn-scratch.ts`:**
```typescript
// Build URN from single segment
export type BuildURN<NS extends string, Pattern> =
  Pattern extends 'segment'
    ? `urn:${NS}:${string}`
    : never;

export type ProjectURN = BuildURN<'project', 'segment'>;

// Tests
export type Test7 = Equals<ProjectURN, `urn:project:${string}`>; // Should be: true
export type Test8 = Equals<ProjectURN, 'urn:project:'>; // Should be: false
export type Test9 = Equals<ProjectURN, never>; // Should be: false

// Runtime
export const proj1: ProjectURN = 'urn:project:myproject';
export const proj2: ProjectURN = 'urn:project:';
```

### Step 4: Now Try 'segments' (Multiple)

**Add to `urn-scratch.ts`:**
```typescript
// Transform 'segments' to string
export type TransformSegments<T> = T extends 'segments' ? string : never;

export type SegmentsResult = TransformSegments<'segments'>;
export type Test10 = Equals<SegmentsResult, string>; // Should be: true

// Build URN with segments
export type BuildURNSegments<NS extends string, Pattern> =
  Pattern extends 'segments'
    ? `urn:${NS}:${string}`
    : never;

export type OrgURNSimple = BuildURNSegments<'org', 'segments'>;

// CRITICAL TESTS
export type Test11 = Equals<OrgURNSimple, `urn:org:${string}`>; // Should be: true
export type Test12 = Equals<OrgURNSimple, 'urn:org:'>; // Should be: false
export type Test13 = Equals<OrgURNSimple, never>; // Should be: false

// Runtime
export const org1: OrgURNSimple = 'urn:org:acme';
export const org2: OrgURNSimple = 'urn:org:acme:division';
export const org3: OrgURNSimple = 'urn:org:';
```

**If Test11 is false or Test13 is true, we've found the issue!**

### Step 5: Object with Type Field

**Add to `urn-scratch.ts`:**
```typescript
// Object pattern
export type SegmentObj = { type: 'segment' };
export type SegmentsObj = { type: 'segments' };

export type TransformObj<T> =
  T extends { type: 'segment' } ? string :
  T extends { type: 'segments' } ? string :
  never;

export type ObjResult1 = TransformObj<SegmentObj>;
export type ObjResult2 = TransformObj<SegmentsObj>;

export type Test14 = Equals<ObjResult1, string>; // Should be: true
export type Test15 = Equals<ObjResult2, string>; // Should be: true
```

### Step 6: Object with Optional Property

**Add to `urn-scratch.ts`:**
```typescript
// With optional validator
export type SegmentsWithOpt = {
  type: 'segments';
  validator?: (s: string) => boolean;
};

export type TransformWithOpt<T> =
  T extends { type: 'segments'; validator?: any } ? string :
  T extends { type: 'segments' } ? string :
  never;

export type OptResult = TransformWithOpt<SegmentsWithOpt>;
export type Test16 = Equals<OptResult, string>; // Should be: true
export type Test17 = Equals<OptResult, never>; // Should be: false

// Also test without the optional property
export type SimpleResult = TransformWithOpt<SegmentsObj>;
export type Test18 = Equals<SimpleResult, string>; // Should be: true
```

### Step 7: Array with Single Element

**Add to `urn-scratch.ts`:**
```typescript
// Array extraction
export type TransformArray<T> =
  T extends [{ type: 'segments' }] ? string :
  T extends readonly [{ type: 'segments' }] ? string :
  never;

export type ArrayResult1 = TransformArray<[SegmentsObj]>;
export type ArrayResult2 = TransformArray<readonly [SegmentsObj]>;
export type ArrayResult3 = TransformArray<[SegmentsWithOpt]>;

export type Test19 = Equals<ArrayResult1, string>; // Should be: true
export type Test20 = Equals<ArrayResult2, string>; // Should be: true
export type Test21 = Equals<ArrayResult3, string>; // Should be: true
```

### Step 8: Array with Destructuring

**Add to `urn-scratch.ts`:**
```typescript
// Destructuring with inference
export type TransformDestruct<T> =
  T extends readonly [infer First, ...infer Rest]
    ? First extends { type: 'segments' }
      ? 'MATCH'
      : 'NO_MATCH'
    : 'NOT_ARRAY';

export type DestructResult1 = TransformDestruct<readonly [SegmentsObj]>;
export type DestructResult2 = TransformDestruct<readonly [SegmentsWithOpt]>;

export type Test22 = Equals<DestructResult1, 'MATCH'>; // Should be: true
export type Test23 = Equals<DestructResult2, 'MATCH'>; // Should be: true?

// If Test23 fails, try checking what First becomes
export type ExtractFirst<T> =
  T extends readonly [infer First, ...infer Rest] ? First : never;
export type WhatIsFirst = ExtractFirst<readonly [SegmentsWithOpt]>;
// Hover over WhatIsFirst in IDE to see actual type
```

### Step 9: The Full Pattern Match

**Add to `urn-scratch.ts`:**
```typescript
// The actual failing pattern from original code
export type ActualTransform<T> =
  T extends readonly [infer First, ...infer Rest]
    ? First extends { type: 'segments'; validator?: unknown }
      ? `${string}`
      : never
    : never;

export type ActualResult = ActualTransform<readonly [SegmentsWithOpt]>;
export type Test24 = Equals<ActualResult, `${string}`>; // Should be: true
export type Test25 = Equals<ActualResult, never>; // Should be: false

// Build full URN
export type MakeURN<NS extends string, Pattern> =
  Pattern extends readonly [infer First, ...infer Rest]
    ? First extends { type: 'segments' }
      ? `urn:${NS}:${string}`
      : never
    : never;

export type FinalOrgURN = MakeURN<'org', readonly [SegmentsWithOpt]>;
export type Test26 = Equals<FinalOrgURN, `urn:org:${string}`>; // Should be: true
export type Test27 = Equals<FinalOrgURN, never>; // Should be: false
```

### Step 10: Debug Failed Tests

For any test that fails (returns false when it should be true):

1. **Hover over the type in IDE** to see what it actually is
2. **Add intermediate types** to trace the transformation:
   ```typescript
   export type Debug1 = readonly [SegmentsWithOpt];
   export type Debug2 = Debug1 extends readonly [infer First, ...infer Rest]
     ? { first: First, rest: Rest }
     : 'FAILED';
   export type Debug3 = Debug2['first'] extends { type: 'segments' }
     ? 'YES'
     : 'NO';
   ```

3. **Try alternative approaches** based on where it fails:
   - If array destructuring fails: Try indexed access `T[0]`
   - If optional property matching fails: Try without optional check
   - If template literal fails: Try with plain `string`

## Commands to Run

After each step:
```bash
cd /home/oskar/Repos/emmett/src/packages/emmett
npx tsc --noEmit src/typing/urn-scratch.ts
```

Check:
1. File compiles without unexpected errors
2. @ts-expect-error lines have errors
3. Hover over Test types to see if they're `true` or `false`

## Success Criteria

Find exactly where the type transformation breaks:
- [ ] Template literals work (Step 1)
- [ ] Single segment transforms (Step 2-3)
- [ ] Multiple segments transform (Step 4)
- [ ] Objects work (Step 5)
- [ ] Optional properties work (Step 6)
- [ ] Arrays work (Step 7)
- [ ] Destructuring works (Step 8)
- [ ] Full pattern works (Step 9)

The step where tests fail tells us what to fix in the original `urn.ts`.