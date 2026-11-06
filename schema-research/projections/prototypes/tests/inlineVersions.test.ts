// Compiles code snippets with the TypeScript compiler and checks which ones a plain versions array, passed straight to Event(...) or a projection, rejects.
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
    import { Event, projection, V1, V2 } from '../experiments/inline-versions.js';
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

describe('versions array passed straight to Event and projection', () => {
  it('rejects a field the previous version does not have', () => {
    const errors = compileErrors(`
      Event('Confirmed', { data: [{ schema: V1 }, { schema: V2, upcast: (v1) => ({ clientId: v1.nope, totalAmount: v1.total }) }] });
    `);

    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /Property 'nope' does not exist on type '\{ clientId: string; total: number; \}'/);
  });

  it('requires an upcast when the previous version does not fit the next schema', () => {
    const errors = compileErrors(`projection({ collectionName: 'carts', schema: [{ schema: V1 }, { schema: V2 }] });`);

    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /Property 'upcast' is missing/);
  });
});
