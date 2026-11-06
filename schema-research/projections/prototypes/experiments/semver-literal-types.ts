// Do declared semver strings give literal types for an exhaustive switch, as list positions do?
type Entry = { version: string };
const declared = <const E extends readonly Entry[]>(entries: E): E[number]['version'] => entries[entries.length - 1]!.version;

const stored = declared([{ version: '1.0.0' }, { version: '1.1.0' }, { version: '2.0.0' }]);

const describe = (version: typeof stored): string => {
  switch (version) {
    case '1.0.0':
      return 'first';
    case '1.1.0':
      return 'compatible';
    case '2.0.0':
      return 'breaking';
  }
};

const exhaustive: (version: typeof stored) => string = describe;
console.log(exhaustive(stored));
