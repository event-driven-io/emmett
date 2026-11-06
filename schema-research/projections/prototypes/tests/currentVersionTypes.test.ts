// Compiles code snippets with the TypeScript compiler and checks which ones Event(...) with an optional currentVersion rejects.
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
    import { Event, Prepared, type StoredConfirmed, V1, V2, V3 } from '../experiments/current-version-types.js';
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


const threeVersions = (v3: string, currentVersion: string) => `
  Event('Confirmed', {
    data: [
      { schema: V1 },
      { schema: V2, upcast: (v1) => ({ clientId: v1.clientId, totalAmount: v1.total }) },
      { schema: V3, upcast: (v2) => ({ ...v2, note: '' })${v3} },
    ],
    ${currentVersion}
  });
`;

describe('Event with an optional currentVersion', () => {
  it('lets downcast be left out when currentVersion is left out', () => {
    assert.deepEqual(compileErrors(threeVersions('', '')), []);
  });

  it('requires a downcast on an entry after currentVersion', () => {
    const errors = compileErrors(threeVersions('', 'currentVersion: 2,'));

    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /Property 'downcast' is missing/);
  });

  it('rejects a currentVersion that is not in the list, and also asks v2 for a downcast', () => {
    const errors = compileErrors(threeVersions(', downcast: ({ note: _note, ...v2 }) => v2', 'currentVersion: 4,'));

    assert.equal(errors.length, 2);
    assert.match(errors[0]!, /Property 'downcast' is missing/);
    assert.match(errors[1]!, /Type '4' is not assignable to type '1 \| 2 \| 3 \| undefined'/);
  });

  it('gives the code the type of the currentVersion entry', () => {
    const errors = compileErrors(`const note: string = ({} as typeof Prepared.Type).data.note;`);

    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /Property 'note' does not exist/);
  });

  it('makes a switch over the stored versions handle every version', () => {
    const errors = compileErrors(`
      export const describe = (stored: StoredConfirmed): string => {
        switch (stored.schemaVersion) {
          case 1:
            return 'v1';
          case 2:
            return 'v2';
        }
      };
    `);

    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /Function lacks ending return statement/);
  });
});
