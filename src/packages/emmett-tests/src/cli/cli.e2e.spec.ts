import { strict as assert } from 'assert';
import { execSync } from 'child_process';
import fs from 'fs';
import { before, describe, it } from 'node:test';
import path from 'path';
import { fileURLToPath } from 'url';

const configContent = `
export default {
    plugins: ['@event-driven-io/emmett-postgresql'],
};
`;

void describe('Emmett CLI Integration Tests', () => {
  const projectDir = path.resolve(fileURLToPath(import.meta.url));

  before(() => {
    // Create emmett.config.ts in the test directory
    fs.writeFileSync(
      path.join(projectDir, '..', '..', 'emmett.config.mts'),
      configContent,
      'utf8',
    );
  });

  void it('should run emmett CLI and execute plugin commands', () => {
    // Run the Emmett CLI command using execSync
    const result = execSync(
      `emmett migrate run --config --connectionString postgres://user:pass@localhost/test`,
      { encoding: 'utf-8' },
    );

    // Assertions
    assert(
      result.includes('Nothing has happened, but test was successful'),
      'Expected success message not found in stdout',
    );
  });
});
