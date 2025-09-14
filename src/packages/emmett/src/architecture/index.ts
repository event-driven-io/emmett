export type EmmettRelationshipType = string;

export interface EmmettArchModule {
  name: string;
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

export type EmmettComponent<
  NestedComponents extends
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Record<string, EmmettComponent<any>> | undefined = undefined,
> = EmmettArchModule &
  (NestedComponents extends undefined
    ? // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      {}
    : {
        components: NestedComponents;
      });

export interface EmmettContainer<
  T extends Record<string, EmmettComponent> = Record<string, EmmettComponent>,
> extends EmmettArchModule {
  components?: T;
}

export interface EmmettSystem<
  T extends Record<string, EmmettContainer> = Record<string, EmmettContainer>,
> extends EmmettArchModule {
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

// const emmettComponent = <T extends Omit<EmmettComponent<any>, 'name'>>(
//   name: string,
//   config?: T,
// ) => {
//   return { name, ...config } satisfies EmmettComponent;
// };

export type ComponentsOf<T extends EmmettComponent> = T extends {
  components: infer M;
}
  ? M
  : undefined;

export const emmettComponent = <
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Config extends Omit<EmmettComponent<any>, 'name'>,
>(
  ...args: Config extends {
    components: infer M;
  }
    ? [name: string, config: Config & { components: M }]
    : [name: string]
): EmmettComponent & {
  components: Config extends { components: infer M } ? M : never;
} => {
  const [name, config] = args;

  return config !== undefined
    ? ({ name, ...config } satisfies EmmettComponent)
    : ({ name } satisfies EmmettComponent);
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
  };
}

const emmettSystem = <T extends Record<string, EmmettContainer>>(
  name: string,
  containers?: T,
): EmmettSystem<T> => ({
  name,
  containers,
});

const emmettRelationship = <
  Source extends AnyEmmettArchModule,
  Target extends AnyEmmettArchModule,
>(
  source: Source,
  type: EmmettRelationshipType,
  target: Target,
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

export const moduleBuilder = <Source extends AnyEmmettArchModule>(
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
