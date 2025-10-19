import type {
  SegmentsSchema,
  LiteralSchema,
  URNSchema,
  PatternToTemplate,
  SchemaToURN,
} from './urn';

export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

export type BasicTemplate = `urn:org:${string}`;

export type Test1 = Equals<BasicTemplate, `urn:org:${string}`>;
export type Test2 = Equals<BasicTemplate, 'urn:org:'>;
export type Test3 = Equals<BasicTemplate, never>;

export const test1Check: Test1 = true;
export const test2Check: Test2 = false;
export const test3Check: Test3 = false;

export const valid1: BasicTemplate = 'urn:org:acme';
export const valid2: BasicTemplate = 'urn:org:';
export const valid3: BasicTemplate = 'urn:org:a:b:c';

export type TestInvalid1 = Equals<BasicTemplate, 'urn:team:acme'>;
export const testInvalid1: TestInvalid1 = false;

export type TestInvalid2 = Equals<BasicTemplate, 'acme'>;
export const testInvalid2: TestInvalid2 = false;

export type TransformSegment<T> = T extends 'segment' ? string : never;

export type SegmentResult = TransformSegment<'segment'>;
export type WrongResult = TransformSegment<'wrong'>;

export type Test4 = Equals<SegmentResult, string>;
export type Test5 = Equals<SegmentResult, never>;
export type Test6 = Equals<WrongResult, never>;

export const test4Check: Test4 = true;
export const test5Check: Test5 = false;
export const test6Check: Test6 = true;

export const seg1: SegmentResult = 'anything';
export const seg2: SegmentResult = '';

export type BuildURN<NS extends string, Pattern> = Pattern extends 'segment'
  ? `urn:${NS}:${string}`
  : never;

export type ProjectURN = BuildURN<'project', 'segment'>;

export type Test7 = Equals<ProjectURN, `urn:project:${string}`>;
export type Test8 = Equals<ProjectURN, 'urn:project:'>;
export type Test9 = Equals<ProjectURN, never>;

export const test7Check: Test7 = true;
export const test8Check: Test8 = false;
export const test9Check: Test9 = false;

export const proj1: ProjectURN = 'urn:project:myproject';
export const proj2: ProjectURN = 'urn:project:';

export type TransformSegments<T> = T extends 'segments' ? string : never;

export type SegmentsResult = TransformSegments<'segments'>;

export type BuildURNSegments<
  NS extends string,
  Pattern,
> = Pattern extends 'segments' ? `urn:${NS}:${string}` : never;

export type OrgURNSimple = BuildURNSegments<'org', 'segments'>;

export type Test10 = Equals<SegmentsResult, string>;
export type Test11 = Equals<OrgURNSimple, `urn:org:${string}`>;
export type Test12 = Equals<OrgURNSimple, 'urn:org:'>;
export type Test13 = Equals<OrgURNSimple, never>;

export const test10Check: Test10 = true;
export const test11Check: Test11 = true;
export const test12Check: Test12 = false;
export const test13Check: Test13 = false;

export const org1: OrgURNSimple = 'urn:org:acme';
export const org2: OrgURNSimple = 'urn:org:acme:division';
export const org3: OrgURNSimple = 'urn:org:';

export type SegmentObj = { type: 'segment' };
export type SegmentsObj = { type: 'segments' };

export type TransformObj<T> = T extends { type: 'segment' }
  ? string
  : T extends { type: 'segments' }
    ? string
    : never;

export type ObjResult1 = TransformObj<SegmentObj>;
export type ObjResult2 = TransformObj<SegmentsObj>;

export type Test14 = Equals<ObjResult1, string>;
export type Test15 = Equals<ObjResult2, string>;

export const test14Check: Test14 = true;
export const test15Check: Test15 = true;

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

export type Test16 = Equals<OptResult, string>;
export type Test17 = Equals<OptResult, never>;
export type Test18 = Equals<SimpleResult, string>;

export const test16Check: Test16 = true;
export const test17Check: Test17 = false;
export const test18Check: Test18 = true;

export type TransformArray<T> = T extends [{ type: 'segments' }]
  ? string
  : T extends readonly [{ type: 'segments' }]
    ? string
    : never;

export type ArrayResult1 = TransformArray<[SegmentsObj]>;
export type ArrayResult2 = TransformArray<readonly [SegmentsObj]>;
export type ArrayResult3 = TransformArray<[SegmentsWithOpt]>;

export type Test19 = Equals<ArrayResult1, string>;
export type Test20 = Equals<ArrayResult2, string>;
export type Test21 = Equals<ArrayResult3, string>;

export const test19Check: Test19 = true;
export const test20Check: Test20 = true;
export const test21Check: Test21 = true;

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

export type Test22 = Equals<DestructResult1, 'MATCH'>;
export type Test23 = Equals<DestructResult2, 'MATCH'>;

export const test22Check: Test22 = true;
export const test23Check: Test23 = true;

export type ActualTransform<T> = T extends readonly [
  infer First,
  ...infer _Rest,
]
  ? First extends { type: 'segments'; validator?: unknown }
    ? `${string}`
    : never
  : never;

export type ActualResult = ActualTransform<readonly [SegmentsWithOpt]>;

export type MakeURN<NS extends string, Pattern> = Pattern extends readonly [
  infer First,
  ...infer _Rest,
]
  ? First extends { type: 'segments' }
    ? `urn:${NS}:${string}`
    : never
  : never;

export type FinalOrgURN = MakeURN<'org', readonly [SegmentsWithOpt]>;

export type Test24 = Equals<ActualResult, `${string}`>;
export type Test25 = Equals<ActualResult, never>;
export type Test26 = Equals<FinalOrgURN, `urn:org:${string}`>;
export type Test27 = Equals<FinalOrgURN, never>;

export const test24Check: Test24 = true;
export const test25Check: Test25 = false;
export const test26Check: Test26 = true;
export const test27Check: Test27 = false;

export const finalOrg1: FinalOrgURN = 'urn:org:acme';
export const finalOrg2: FinalOrgURN = 'urn:org:acme:division';

export type LiteralTeam = { type: 'literal'; value: 'team' };

export type TransformLiteral<T> = T extends { type: 'literal'; value: infer V }
  ? V
  : never;

export type LiteralResult = TransformLiteral<LiteralTeam>;

export type Test28 = Equals<LiteralResult, 'team'>;
export type Test29 = Equals<LiteralResult, string>;
export type Test30 = Equals<LiteralResult, never>;

export const test28Check: Test28 = true;
export const test29Check: Test29 = false;
export const test30Check: Test30 = false;

export type TwoElementPattern = readonly [SegmentsWithOpt, LiteralTeam];
export type TwoElementResult = PatternToTemplate<TwoElementPattern>;

export type Test31 = Equals<TwoElementResult, `${string}:team`>;
export type Test32 = Equals<TwoElementResult, never>;

export const test31Check: Test31 = true;
export const test32Check: Test32 = false;

// Build complete URN
export type BuildCompleteURN<
  NS extends string,
  Pattern,
> = `urn:${NS}:${PatternToTemplate<Pattern>}`;

export type TeamURN = BuildCompleteURN<'org', TwoElementPattern>;

export type Test33 = Equals<TeamURN, `urn:org:${string}:team`>;
export type Test34 = Equals<TeamURN, never>;

export const test33Check: Test33 = true;
export const test34Check: Test34 = false;

export const team1: TeamURN = 'urn:org:acme:team';
export const team2: TeamURN = 'urn:org:acme:emea:division:team';

export type Pattern1 = readonly [LiteralTeam];
export type Result1 = PatternToTemplate<Pattern1>;
export type Test35 = Equals<Result1, 'team'>;
export const test35Check: Test35 = true;

export type LiteralOrg = { type: 'literal'; value: 'org' };
export type Pattern2 = readonly [LiteralOrg, LiteralTeam];
export type Result2 = PatternToTemplate<Pattern2>;
export type Test36 = Equals<Result2, 'org:team'>;
export const test36Check: Test36 = true;

export type Pattern3 = readonly [LiteralOrg, SegmentsWithOpt];
export type Result3 = PatternToTemplate<Pattern3>;
export type Test37 = Equals<Result3, `org:${string}`>;
export const test37Check: Test37 = true;

export type Pattern4 = readonly [SegmentsWithOpt];
export type Result4 = PatternToTemplate<Pattern4>;
export type Test38 = Equals<Result4, `${string}`>;
export const test38Check: Test38 = true;

export type Test39 = Equals<TwoElementResult, `${string}:team`>;
export const test39Check: Test39 = true;

export type Pattern6 = readonly [SegmentsWithOpt, LiteralTeam, SegmentsWithOpt];
export type Result6 = PatternToTemplate<Pattern6>;
export type Test40 = Equals<Result6, `${string}:team:${string}`>;
export const test40Check: Test40 = true;

export type FullTeamURN = BuildCompleteURN<'org', Pattern6>;
export type Test41 = Equals<FullTeamURN, `urn:org:${string}:team:${string}`>;
export const test41Check: Test41 = true;

export const fullTeam1: FullTeamURN = 'urn:org:acme:team:eng';
export const fullTeam2: FullTeamURN = 'urn:org:acme:emea:team:division:subdiv';

type OrgSchema = URNSchema<'org', readonly [SegmentsSchema]>;
export type OrgURN = SchemaToURN<OrgSchema>;
export type Test42 = Equals<OrgURN, `urn:org:${string}`>;
export const test42Check: Test42 = true;

type TeamSchema = URNSchema<
  'org',
  readonly [SegmentsSchema, LiteralSchema<'team'>, SegmentsSchema]
>;
export type TeamURNFromSchema = SchemaToURN<TeamSchema>;
export type Test43 = Equals<
  TeamURNFromSchema,
  `urn:org:${string}:team:${string}`
>;
export const test43Check: Test43 = true;
