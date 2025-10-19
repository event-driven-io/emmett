import type {
  SegmentsSchema,
  LiteralSchema,
  URNSchema,
  PatternToTemplate,
  SchemaToURN,
} from './urn';
import type { Equals } from './test-utils';

type OrgSchema = URNSchema<'org', readonly [SegmentsSchema]>;
type OrgURN = SchemaToURN<OrgSchema>;

type OrgURN_ShouldBeTemplateString = Equals<OrgURN, `urn:org:${string}`>;
type OrgURN_ShouldNotBeEmptyString = Equals<OrgURN, 'urn:org:'>;
type OrgURN_ShouldNotBeNever = Equals<OrgURN, never>;

const _orgURN_shouldBeTemplateString: OrgURN_ShouldBeTemplateString = true;
const _orgURN_shouldNotBeEmptyString: OrgURN_ShouldNotBeEmptyString = false;
const _orgURN_shouldNotBeNever: OrgURN_ShouldNotBeNever = false;

const _orgExample1: OrgURN = 'urn:org:acme';
const _orgExample2: OrgURN = 'urn:org:acme:division:subdivision';

type TeamSchema = URNSchema<
  'org',
  readonly [SegmentsSchema, LiteralSchema<'team'>, SegmentsSchema]
>;
type TeamURN = SchemaToURN<TeamSchema>;

type TeamURN_ShouldHaveTeamLiteral = Equals<
  TeamURN,
  `urn:org:${string}:team:${string}`
>;
type TeamURN_ShouldNotBeOrgOnly = Equals<TeamURN, `urn:org:${string}`>;
type TeamURN_ShouldNotBeNever = Equals<TeamURN, never>;

const _teamURN_shouldHaveTeamLiteral: TeamURN_ShouldHaveTeamLiteral = true;
const _teamURN_shouldNotBeOrgOnly: TeamURN_ShouldNotBeOrgOnly = false;
const _teamURN_shouldNotBeNever: TeamURN_ShouldNotBeNever = false;

const _teamExample1: TeamURN = 'urn:org:acme:team:eng';
const _teamExample2: TeamURN = 'urn:org:acme:emea:team:platform:backend';

type Pattern_SingleSegment = PatternToTemplate<readonly [SegmentsSchema]>;
type SingleSegment_ShouldBeString = Equals<Pattern_SingleSegment, `${string}`>;
const _singleSegment_shouldBeString: SingleSegment_ShouldBeString = true;

type Pattern_SingleLiteral = PatternToTemplate<
  readonly [LiteralSchema<'user'>]
>;
type SingleLiteral_ShouldBeUser = Equals<Pattern_SingleLiteral, 'user'>;
const _singleLiteral_shouldBeUser: SingleLiteral_ShouldBeUser = true;

type Pattern_TwoLiterals = PatternToTemplate<
  readonly [LiteralSchema<'org'>, LiteralSchema<'team'>]
>;
type TwoLiterals_ShouldBeOrgTeam = Equals<Pattern_TwoLiterals, 'org:team'>;
const _twoLiterals_shouldBeOrgTeam: TwoLiterals_ShouldBeOrgTeam = true;

type Pattern_SegmentsThenLiteral = PatternToTemplate<
  readonly [SegmentsSchema, LiteralSchema<'team'>]
>;
type SegmentsThenLiteral_ShouldHaveTeamAtEnd = Equals<
  Pattern_SegmentsThenLiteral,
  `${string}:team`
>;
const _segmentsThenLiteral_shouldHaveTeamAtEnd: SegmentsThenLiteral_ShouldHaveTeamAtEnd =
  true;

type Pattern_LiteralThenSegments = PatternToTemplate<
  readonly [LiteralSchema<'org'>, SegmentsSchema]
>;
type LiteralThenSegments_ShouldHaveOrgAtStart = Equals<
  Pattern_LiteralThenSegments,
  `org:${string}`
>;
const _literalThenSegments_shouldHaveOrgAtStart: LiteralThenSegments_ShouldHaveOrgAtStart =
  true;

type Pattern_Complex = PatternToTemplate<
  readonly [SegmentsSchema, LiteralSchema<'resource'>, SegmentsSchema]
>;
type Complex_ShouldHaveResourceInMiddle = Equals<
  Pattern_Complex,
  `${string}:resource:${string}`
>;
const _complex_shouldHaveResourceInMiddle: Complex_ShouldHaveResourceInMiddle =
  true;

type Pattern_Empty = PatternToTemplate<readonly []>;
type EmptyPattern_ShouldBeEmptyString = Equals<Pattern_Empty, ''>;
const _emptyPattern_shouldBeEmptyString: EmptyPattern_ShouldBeEmptyString =
  true;

type EmptySchema = URNSchema<'test', readonly []>;
type EmptyURN = SchemaToURN<EmptySchema>;
type EmptyURN_ShouldBeJustPrefix = Equals<EmptyURN, 'urn:test:'>;
const _emptyURN_shouldBeJustPrefix: EmptyURN_ShouldBeJustPrefix = true;

type ComplexSchema = URNSchema<
  'project',
  readonly [
    SegmentsSchema,
    LiteralSchema<'task'>,
    SegmentsSchema,
    LiteralSchema<'subtask'>,
    SegmentsSchema,
  ]
>;
type ComplexURN = SchemaToURN<ComplexSchema>;
type ComplexURN_ShouldHaveFullStructure = Equals<
  ComplexURN,
  `urn:project:${string}:task:${string}:subtask:${string}`
>;
const _complexURN_shouldHaveFullStructure: ComplexURN_ShouldHaveFullStructure =
  true;

const _complexExample: ComplexURN = 'urn:project:web:task:123:subtask:456';
