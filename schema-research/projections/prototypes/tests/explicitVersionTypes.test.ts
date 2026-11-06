// Compiles code snippets with the TypeScript compiler and checks how each version, All and Any behave without currentVersion.
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
    import { z } from 'zod';
    import { Event, ShoppingCartConfirmed, upcast } from '../experiments/explicit-version-types.js';
    type Versions = typeof ShoppingCartConfirmed.Versions;
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


describe('versions picked explicitly, without currentVersion', () => {
  it('does not allow a version number after a dot', () => {
    const errors = compileErrors(`export type V2 = Versions.2;`);

    assert.ok(errors.length > 0);
  });

  it('does not narrow by schemaVersion inside metadata', () => {
    const errors = compileErrors(`
      export const read = (message: Versions[1] | Versions[2]) =>
        message.metadata.schemaVersion === 1 ? message.data.total : message.data.totalAmount;
    `);

    assert.equal(errors.length, 2);
    assert.match(errors[0]!, /Property 'total' does not exist/);
  });

  it('rejects evolve on a version the upcast does not return', () => {
    const errors = compileErrors(`
      export const evolve = (state: number, event: Versions[3]) => state + event.data.note.length;
      export const fold = (messages: Versions['Any'][]) => messages.map(upcast).reduce(evolve, 0);
    `);

    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /Type '2' is not assignable to type '3'/);
  });

  it('makes All never when versions give one field different types', () => {
    const errors = compileErrors(`
      const Changed = Event('Changed', { data: [z.object({ total: z.number() }), z.object({ total: z.string() })] });
      export const all: (typeof Changed.Versions)['All'] = { type: 'Changed', data: { total: 1 } };
    `);

    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /is not assignable to type 'never'/);
  });
});
