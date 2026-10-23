import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const result = spawnSync('npx', ['nuxt', 'generate', '--fail-on-error'], {
  encoding: 'utf8',
});

const output = `${result.stdout}${result.stderr}`;

console.log(output);

if (result.status !== 0) {
  throw new Error(`nuxt generate failed with exit code ${result.status}`);
}

if (output.toLowerCase().includes('[request error]')) {
  throw new Error('nuxt generate reported request errors');
}

const page = readFileSync('.output/public/index.html', 'utf8');

if (!page.includes('opened')) {
  throw new Error('Generated page does not show the counter state');
}
