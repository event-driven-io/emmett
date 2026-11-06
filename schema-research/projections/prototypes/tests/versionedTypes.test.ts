// Compiles code snippets with the TypeScript compiler and checks which ones the versions list rejects.
// Run: npm test
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const projectDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const snippetFile = join(projectDirectory, 'tests', '__snippet__.ts');

const compilerOptions = (() => {
  const configFile = join(projectDirectory, 'tsconfig.json');
  const { config } = ts.readConfigFile(configFile, ts.sys.readFile);
  return ts.parseJsonConfigFileContent(config, ts.sys, projectDirectory).options;
})();

const compileErrors = (body: string): string[] => {
  const source = `
    import { byMap, V1, V2, V3, versions } from '../experiments/versioned-inference.js';
    import { versioned } from '../lib/versionedSchema.js';
    ${body}
  `;
  const host = ts.createCompilerHost(compilerOptions);
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    fileName === snippetFile ? ts.createSourceFile(fileName, source, languageVersion) : getSourceFile(fileName, languageVersion, ...rest);
  const fileExists = host.fileExists;
  host.fileExists = (fileName) => fileName === snippetFile || fileExists(fileName);

  const program = ts.createProgram([snippetFile], compilerOptions, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === snippetFile)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
};

describe('versions list types', () => {
  it('types each upcast and downcast argument from the neighbouring versions', () => {
    assert.deepEqual(
      compileErrors(`
        versioned([
          { schema: V1 },
          {
            schema: V2,
            upcast: (v1) => ({ clientId: v1.clientId, totalAmount: v1.total }),
            downcast: (v2) => ({ clientId: v2.clientId, total: v2.totalAmount }),
          },
          { schema: V3 },
        ]);
      `),
      [],
    );
  });

  it('rejects a field the previous version does not have', () => {
    const errors = compileErrors(`
      versioned([{ schema: V1 }, { schema: V2, upcast: (v1) => ({ clientId: v1.nope, totalAmount: v1.total }) }]);
    `);

    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /Property 'nope' does not exist on type '\{ clientId: string; total: number; \}'/);
  });

  it('rejects an upcast that does not return the next version', () => {
    const errors = compileErrors(`
      versioned([{ schema: V1 }, { schema: V2, upcast: (v1) => ({ clientId: v1.clientId, total: v1.total }) }]);
    `);

    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /Property 'totalAmount' is missing/);
  });

  it('requires an upcast when the previous version does not fit the next schema', () => {
    const errors = compileErrors(`versioned([{ schema: V1 }, { schema: V2 }]);`);

    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /Property 'upcast' is missing/);
  });

  it('a chain types the upcast argument and requires an upcast when the shape changed', () => {
    assert.deepEqual(compileErrors(`versions(V1).then(V2, { upcast: (v1) => ({ clientId: v1.clientId, totalAmount: v1.total }) }).then(V3);`), []);
    assert.match(compileErrors(`versions(V1).then(V2);`).join('\n'), /Expected 2 arguments, but got 1/);
  });

  it('a map keyed by version gives the upcast argument no type', () => {
    const errors = compileErrors(`
      byMap({
        '1': { schema: V1 },
        '2': { schema: V2, upcast: (v1) => ({ clientId: v1.clientId, totalAmount: v1.total }) },
      });
    `);

    assert.match(errors.join('\n'), /Property 'clientId' does not exist on type 'never'/);
  });

  it('one upcast function gets a union of the stored versions, narrowed by schemaVersion', () => {
    assert.deepEqual(
      compileErrors(`
        versioned([{ schema: V1 }, { schema: V2 }], {
          upcast: (stored) => {
            switch (stored.schemaVersion) {
              case 1:
                return { clientId: stored.value.clientId, totalAmount: stored.value.total };
              case 2:
                return stored.value;
            }
          },
        });
      `),
      [],
    );
  });

  it('one upcast function rejects a field the narrowed version does not have', () => {
    const errors = compileErrors(`
      versioned([{ schema: V1 }, { schema: V2 }], {
        upcast: (stored) => {
          switch (stored.schemaVersion) {
            case 1:
              return { clientId: stored.value.clientId, totalAmount: stored.value.totalAmount };
            case 2:
              return stored.value;
          }
        },
      });
    `);

    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /Property 'totalAmount' does not exist on type '\{ clientId: string; total: number; \}'/);
  });

  it('one upcast function must handle every stored version', () => {
    const errors = compileErrors(`
      versioned([{ schema: V1 }, { schema: V2 }], {
        upcast: (stored) => {
          switch (stored.schemaVersion) {
            case 2:
              return stored.value;
          }
        },
      });
    `);

    assert.equal(errors.length, 2);
    assert.match(errors[0]!, /Type 'undefined' is not assignable to type '\{ clientId: string; totalAmount: number; \}'/);
    assert.equal(errors[1], 'Not all code paths return a value.');
  });
});
