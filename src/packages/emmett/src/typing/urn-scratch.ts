// ============================================================================
// Step 1: Basic template literal - REFACTOR
// ============================================================================

export type BasicTemplate = `urn:org:${string}`;

// Type equality checker for testing
export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

// Test that BasicTemplate is actually a template, not literal
export type Test1 = Equals<BasicTemplate, `urn:org:${string}`>; // Should be: true
export type Test2 = Equals<BasicTemplate, 'urn:org:'>; // Should be: false
export type Test3 = Equals<BasicTemplate, never>; // Should be: false

// Force TypeScript to evaluate the test results
export const test1Check: Test1 = true;
export const test2Check: Test2 = false;
export const test3Check: Test3 = false;

// Runtime tests (these should compile)
export const valid1: BasicTemplate = 'urn:org:acme';
export const valid2: BasicTemplate = 'urn:org:';
export const valid3: BasicTemplate = 'urn:org:a:b:c';

// These should NOT compile
// @ts-expect-error - wrong prefix
export const invalid1: BasicTemplate = 'urn:team:acme';
// @ts-expect-error - no prefix
export const invalid2: BasicTemplate = 'acme';

// ============================================================================
// Step 2 REFACTOR: Single segment transform with tests
// ============================================================================

// Transform 'segment' (single) to string type
export type TransformSegment<T> = T extends 'segment' ? string : never;

export type SegmentResult = TransformSegment<'segment'>;
export type Test4 = Equals<SegmentResult, string>; // Should be: true
export type Test5 = Equals<SegmentResult, never>; // Should be: false

// Test wrong input
export type WrongResult = TransformSegment<'wrong'>;
export type Test6 = Equals<WrongResult, never>; // Should be: true

// Force evaluation
export const test4Check: Test4 = true;
export const test5Check: Test5 = false;
export const test6Check: Test6 = true;

// Runtime test
export const seg1: SegmentResult = 'anything';
export const seg2: SegmentResult = '';

// ============================================================================
// Step 3 GREEN: Build URN with single segment
// ============================================================================

export type BuildURN<NS extends string, Pattern> = Pattern extends 'segment'
  ? `urn:${NS}:${string}`
  : never;

export type ProjectURN = BuildURN<'project', 'segment'>;

// Tests
export type Test7 = Equals<ProjectURN, `urn:project:${string}`>; // Should be: true
export type Test8 = Equals<ProjectURN, 'urn:project:'>; // Should be: false
export type Test9 = Equals<ProjectURN, never>; // Should be: false

// Force evaluation
export const test7Check: Test7 = true;
export const test8Check: Test8 = false;
export const test9Check: Test9 = false;

// Runtime
export const proj1: ProjectURN = 'urn:project:myproject';
export const proj2: ProjectURN = 'urn:project:';

// ============================================================================
// Step 4 GREEN: Multiple segments - Build it
// ============================================================================

// Transform 'segments' to string
export type TransformSegments<T> = T extends 'segments' ? string : never;

export type SegmentsResult = TransformSegments<'segments'>;

// Build URN with segments
export type BuildURNSegments<
  NS extends string,
  Pattern,
> = Pattern extends 'segments' ? `urn:${NS}:${string}` : never;

export type OrgURNSimple = BuildURNSegments<'org', 'segments'>;

// CRITICAL TESTS - This is where we check if the bug exists!
export type Test10 = Equals<SegmentsResult, string>; // Should be: true
export type Test11 = Equals<OrgURNSimple, `urn:org:${string}`>; // Should be: true
export type Test12 = Equals<OrgURNSimple, 'urn:org:'>; // Should be: false
export type Test13 = Equals<OrgURNSimple, never>; // Should be: false - IF THIS IS TRUE, WE FOUND THE BUG!

// Force evaluation
export const test10Check: Test10 = true;
export const test11Check: Test11 = true;
export const test12Check: Test12 = false;
export const test13Check: Test13 = false; // If this fails, OrgURN is 'never'!

// Runtime tests
export const org1: OrgURNSimple = 'urn:org:acme';
export const org2: OrgURNSimple = 'urn:org:acme:division';
export const org3: OrgURNSimple = 'urn:org:';
