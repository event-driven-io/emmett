export type EmmettRelationshipType = string;

export type PortRequirements = Record<string, unknown>;

export type EmmettArchModule<
  Requires extends PortRequirements | undefined = undefined,
  Exposes extends PortRequirements | undefined = undefined,
> = {
  name: string;
} & (Requires extends undefined
  ? Exposes extends undefined
    ? { ports?: undefined } // both undefined: ports optional
    : { ports: { exposes: Exposes } } // only Exposes defined
  : Exposes extends undefined
    ? { ports: { requires: Requires } } // only Requires defined
    : { ports: { requires: Requires; exposes: Exposes } }); // both defined

export type AnyEmmettArchModule = EmmettArchModule<any, any>;

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
  Requires extends PortRequirements | undefined = undefined,
  Exposes extends PortRequirements | undefined = undefined,
> = EmmettArchModule<Requires, Exposes> &
  (NestedComponents extends undefined
    ? { components?: undefined }
    : { components: NestedComponents });

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

export function emmettComponent<
  const Config extends {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    components?: Record<string, EmmettComponent<any>>;
    ports?: {
      requires?: PortRequirements;
      exposes?: PortRequirements;
    };
  },
>(
  name: string,
  config?: Config,
): {
  name: string;
  components: Config extends { components: infer C } ? C : undefined;
  ports: Config extends { ports: infer P } ? P : undefined;
} {
  return {
    name,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    components: config?.components as any,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    ports: config?.ports as any,
  };
}

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
  bundle?: (
    target: Target['ports']['exposes'],
  ) => Partial<Source['ports']['requires']>,
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
  ) => emmettRelationship(ctx, type, target, undefined, description),
});

export const emmettArch = {
  system: emmettSystem,
  container: emmettContainer,
  component: emmettComponent,
  relationship: emmettRelationship,
};
