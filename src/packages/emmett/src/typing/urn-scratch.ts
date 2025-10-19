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

// ============================================================================
// Step 5 GREEN: Object with type field
// ============================================================================

// Object pattern
export type SegmentObj = { type: 'segment' };
export type SegmentsObj = { type: 'segments' };

export type TransformObj<T> = T extends { type: 'segment' }
  ? string
  : T extends { type: 'segments' }
    ? string
    : never;

export type ObjResult1 = TransformObj<SegmentObj>;
export type ObjResult2 = TransformObj<SegmentsObj>;

// Tests
export type Test14 = Equals<ObjResult1, string>; // Should be: true
export type Test15 = Equals<ObjResult2, string>; // Should be: true

// Force evaluation
export const test14Check: Test14 = true;
export const test15Check: Test15 = true;

// ============================================================================
// Step 6 GREEN: Object with optional property
// ============================================================================

// With optional validator
export type SegmentsWithOpt = {
  type: 'segments';
  validator?: (s: string) => boolean;
};

export type TransformWithOpt<T> = T extends {
  type: 'segments';
  validator?: unknown;
}
  ? string
  : T extends { type: 'segments' }
    ? string
    : never;

export type OptResult = TransformWithOpt<SegmentsWithOpt>;
export type SimpleResult = TransformWithOpt<SegmentsObj>;

// Tests
export type Test16 = Equals<OptResult, string>; // Should be: true
export type Test17 = Equals<OptResult, never>; // Should be: false
export type Test18 = Equals<SimpleResult, string>; // Should be: true

// Force evaluation
export const test16Check: Test16 = true;
export const test17Check: Test17 = false;
export const test18Check: Test18 = true;

// ============================================================================
// Step 7 GREEN: Array with single element
// ============================================================================

// Array extraction
export type TransformArray<T> = T extends [{ type: 'segments' }]
  ? string
  : T extends readonly [{ type: 'segments' }]
    ? string
    : never;

export type ArrayResult1 = TransformArray<[SegmentsObj]>;
export type ArrayResult2 = TransformArray<readonly [SegmentsObj]>;
export type ArrayResult3 = TransformArray<[SegmentsWithOpt]>;

// Tests
export type Test19 = Equals<ArrayResult1, string>; // Should be: true
export type Test20 = Equals<ArrayResult2, string>; // Should be: true
export type Test21 = Equals<ArrayResult3, string>; // Should be: true

// Force evaluation
export const test19Check: Test19 = true;
export const test20Check: Test20 = true;
export const test21Check: Test21 = true;

// ============================================================================
// Step 8 GREEN: Array with destructuring - THE ACTUAL PATTERN!
// ============================================================================

// Destructuring with inference (like the original code)
export type TransformDestruct<T> = T extends readonly [
  infer First,
  ...infer _Rest,
]
  ? First extends { type: 'segments' }
    ? 'MATCH'
    : 'NO_MATCH'
  : 'NOT_ARRAY';

export type DestructResult1 = TransformDestruct<readonly [SegmentsObj]>;
export type DestructResult2 = TransformDestruct<readonly [SegmentsWithOpt]>;

// CRITICAL TESTS - Does infer work with optional properties?
export type Test22 = Equals<DestructResult1, 'MATCH'>; // Should be: true
export type Test23 = Equals<DestructResult2, 'MATCH'>; // Should be: true - THIS IS THE KEY TEST!

// Force evaluation
export const test22Check: Test22 = true;
export const test23Check: Test23 = true; // If this fails, we found the bug!

// Debug: What does First become?
export type ExtractFirst<T> = T extends readonly [infer First, ...infer _Rest]
  ? First
  : never;
export type WhatIsFirst = ExtractFirst<readonly [SegmentsWithOpt]>;
// Hover over WhatIsFirst in IDE to see actual type

// ============================================================================
// Step 9 GREEN: Full pattern - Build URN exactly like original code
// ============================================================================

// The actual transform pattern from original code
export type ActualTransform<T> = T extends readonly [
  infer First,
  ...infer _Rest,
]
  ? First extends { type: 'segments'; validator?: unknown }
    ? `${string}`
    : never
  : never;

export type ActualResult = ActualTransform<readonly [SegmentsWithOpt]>;

// Build full URN with destructuring pattern
export type MakeURN<NS extends string, Pattern> = Pattern extends readonly [
  infer First,
  ...infer _Rest,
]
  ? First extends { type: 'segments' }
    ? `urn:${NS}:${string}`
    : never
  : never;

export type FinalOrgURN = MakeURN<'org', readonly [SegmentsWithOpt]>;

// FINAL CRITICAL TESTS - Does the full pattern work?
export type Test24 = Equals<ActualResult, `${string}`>; // Should be: true
export type Test25 = Equals<ActualResult, never>; // Should be: false
export type Test26 = Equals<FinalOrgURN, `urn:org:${string}`>; // Should be: true - THE ULTIMATE TEST!
export type Test27 = Equals<FinalOrgURN, never>; // Should be: false - If true, we replicated the bug!

// Force evaluation
export const test24Check: Test24 = true;
export const test25Check: Test25 = false;
export const test26Check: Test26 = true; // If this fails, we found where it breaks!
export const test27Check: Test27 = false; // If this fails, FinalOrgURN is 'never'!

// Runtime test
export const finalOrg1: FinalOrgURN = 'urn:org:acme';
export const finalOrg2: FinalOrgURN = 'urn:org:acme:division';

// ============================================================================
// Step 10 GREEN: Literal pattern type
// ============================================================================

export type LiteralTeam = { type: 'literal'; value: 'team' };

// Extract the literal value from the pattern
export type TransformLiteral<T> = T extends { type: 'literal'; value: infer V }
  ? V
  : never;

export type LiteralResult = TransformLiteral<LiteralTeam>;

// Tests
export type Test28 = Equals<LiteralResult, 'team'>; // Should be: true
export type Test29 = Equals<LiteralResult, string>; // Should be: false
export type Test30 = Equals<LiteralResult, never>; // Should be: false

// Force evaluation
export const test28Check: Test28 = true;
export const test29Check: Test29 = false;
export const test30Check: Test30 = false;

// ============================================================================
// Step 11 GREEN: Two-element pattern [segments, literal]
// ============================================================================

// Recursive pattern transformer - like the original PatternToTemplate
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
          ? Rest extends readonly []
            ? `${string}`
            : `${string}:${PatternToString<Rest>}`
          : never
    : never;

// Pattern: segments followed by literal 'team'
export type TwoElementPattern = readonly [SegmentsWithOpt, LiteralTeam];
export type TwoElementResult = PatternToString<TwoElementPattern>;

// CRITICAL TESTS - segments should NOT consume rest when followed by more patterns
export type Test31 = Equals<TwoElementResult, `${string}:team`>; // Should be: true
export type Test32 = Equals<TwoElementResult, never>; // Should be: false

// Force evaluation
export const test31Check: Test31 = true; // Will fail until we fix PatternToString
export const test32Check: Test32 = false;

// ============================================================================
// Step 12 GREEN: Full Team URN with namespace
// ============================================================================

// Build complete URN: urn:${namespace}:${pattern}
export type BuildCompleteURN<
  NS extends string,
  Pattern,
> = `urn:${NS}:${PatternToString<Pattern>}`;

// Build complete URN with namespace + pattern
export type TeamURN = BuildCompleteURN<'org', TwoElementPattern>;

// FINAL COMPREHENSIVE TESTS
export type Test33 = Equals<TeamURN, `urn:org:${string}:team`>; // Should be: true
export type Test34 = Equals<TeamURN, never>; // Should be: false

// Force evaluation
export const test33Check: Test33 = true; // Will fail until we fix PatternToString
export const test34Check: Test34 = false;

// Runtime test
export const team1: TeamURN = 'urn:org:acme:team';
export const team2: TeamURN = 'urn:org:acme:emea:division:team';

// ============================================================================
// Step 15 REFACTOR: Comprehensive multi-element pattern tests
// ============================================================================

// Test 1: Single literal
export type Pattern1 = readonly [LiteralTeam];
export type Result1 = PatternToString<Pattern1>;
export type Test35 = Equals<Result1, 'team'>;
export const test35Check: Test35 = true;

// Test 2: Two literals
export type LiteralOrg = { type: 'literal'; value: 'org' };
export type Pattern2 = readonly [LiteralOrg, LiteralTeam];
export type Result2 = PatternToString<Pattern2>;
export type Test36 = Equals<Result2, 'org:team'>;
export const test36Check: Test36 = true;

// Test 3: Literal then segments (segments is last)
export type Pattern3 = readonly [LiteralOrg, SegmentsWithOpt];
export type Result3 = PatternToString<Pattern3>;
export type Test37 = Equals<Result3, `org:${string}`>;
export const test37Check: Test37 = true;

// Test 4: Single segments
export type Pattern4 = readonly [SegmentsWithOpt];
export type Result4 = PatternToString<Pattern4>;
export type Test38 = Equals<Result4, `${string}`>;
export const test38Check: Test38 = true;

// Test 5: Segments then literal (already tested as TwoElementPattern)
export type Test39 = Equals<TwoElementResult, `${string}:team`>;
export const test39Check: Test39 = true;

// Test 6: Full team pattern - segments, literal, segments
export type Pattern6 = readonly [SegmentsWithOpt, LiteralTeam, SegmentsWithOpt];
export type Result6 = PatternToString<Pattern6>;
export type Test40 = Equals<Result6, `${string}:team:${string}`>;
export const test40Check: Test40 = true;

// Test 7: Build full team URN
export type FullTeamURN = BuildCompleteURN<'org', Pattern6>;
export type Test41 = Equals<FullTeamURN, `urn:org:${string}:team:${string}`>;
export const test41Check: Test41 = true;

// Runtime tests for full team pattern
export const fullTeam1: FullTeamURN = 'urn:org:acme:team:eng';
export const fullTeam2: FullTeamURN = 'urn:org:acme:emea:team:division:subdiv';
