export type EmmettRelationshipType = string;

export interface EmmettArchModule<
  Relationships extends AnyEmmettArchModule = never,
> {
  name: string;
  relationships: EmmettRelationshipsMap<this, Relationships>;
}

export type AnyEmmettArchModule =
  | EmmettSystem
  | EmmettContainer
  | EmmettComponent;

export interface EmmettRelationship<
  Source extends AnyEmmettArchModule = AnyEmmettArchModule,
  Target extends AnyEmmettArchModule = AnyEmmettArchModule,
> {
  source: Source['name'];
  target: Target['name'];
  type: EmmettRelationshipType;
  description?: string;
}

export type EmmettRelationshipsMap<
  Source extends AnyEmmettArchModule = AnyEmmettArchModule,
  Target extends AnyEmmettArchModule = AnyEmmettArchModule,
> = Record<Target['name'], EmmettRelationship<Source, Target>>;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EmmettComponent<
  Relationships extends AnyEmmettArchModule = AnyEmmettArchModule,
> extends EmmettArchModule<Relationships> {}

export interface EmmettContainer<
  T extends Record<string, EmmettComponent> = Record<string, EmmettComponent>,
  Relationships extends AnyEmmettArchModule = AnyEmmettArchModule,
> extends EmmettArchModule<Relationships> {
  components?: T;
}

export interface EmmettSystem<
  T extends Record<string, EmmettContainer> = Record<string, EmmettContainer>,
  Relationships extends AnyEmmettArchModule = AnyEmmettArchModule,
> extends EmmettArchModule<Relationships> {
  containers?: T;
}

// export type EmmettComponentsMap<T extends Record<string, EmmettComponent>> = {
//   [K in keyof T]: EmmettComponent<
//     T[K] extends EmmettComponent<infer U> ? U : unknown
//   >;
// };

export type EmmettContainersMap<T extends Record<string, EmmettContainer>> = {
  [K in keyof T]: EmmettContainer<
    T[K] extends EmmettContainer<infer U> ? U : Record<string, EmmettComponent>
  >;
};

export type EmmettSystemsMap<T extends Record<string, EmmettSystem>> = {
  [K in keyof T]: EmmettSystem<
    T[K] extends EmmettSystem<infer U> ? U : Record<string, EmmettContainer>
  >;
};

const emmettComponent = <
  Relationships extends AnyEmmettArchModule = AnyEmmettArchModule,
  TReturn extends
    EmmettComponent<Relationships> = EmmettComponent<Relationships>,
>(
  name: string,
  config?: (builder: ModuleBuilder<TReturn>) => Omit<TReturn, 'name'>,
): TReturn => {
  const defaultConfig = { name } as TReturn;

  if (!config) return defaultConfig;

  return Object.assign(defaultConfig, config(moduleBuilder(defaultConfig)));
};
// ({
//   name,
//   relationships: config?.relationships ? config.relationships : undefined,
// }) satisfies EmmettComponent<T> as unknown as TReturn;

function emmettContainer<T extends Record<string, EmmettComponent>>(
  name: string,
  components?: T,
): EmmettContainer<T> {
  return {
    name,
    components,
    relationships: {},
  };
}

const emmettSystem = <T extends Record<string, EmmettContainer>>(
  name: string,
  containers?: T,
): EmmettSystem<T> => ({
  name,
  containers,
  relationships: {},
});

const emmettRelationship = <
  Source extends AnyEmmettArchModule,
  Target extends AnyEmmettArchModule,
>(
  source: Source,
  target: Target,
  type: EmmettRelationshipType,
  description?: string,
): EmmettRelationship<Source, Target> => ({
  source: source.name,
  target: target.name,
  type,
  description,
});

type ModuleBuilder<Source extends AnyEmmettArchModule> = {
  relationship: <Target extends AnyEmmettArchModule>(
    target: Target,
    type: EmmettRelationshipType,
    description?: string,
  ) => EmmettRelationship<Source, Target>;
};

const moduleBuilder = <Source extends AnyEmmettArchModule>(
  ctx: Source,
): ModuleBuilder<Source> => ({
  relationship: <Target extends AnyEmmettArchModule>(
    target: Target,
    type: EmmettRelationshipType,
    description?: string,
  ) => emmettRelationship(ctx, target, type, description),
});

export const emmettArch = {
  system: emmettSystem,
  container: emmettContainer,
  component: emmettComponent,
  relationship: emmettRelationship,
};
