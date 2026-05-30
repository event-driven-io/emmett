// Aspire-like entry point: one command brings the whole observability stack up,
// renders the concurrent startup, and prints the endpoints. Ctrl-C stops the app
// while leaving the stack warm; SIGTERM tears the whole stack down.

import pc from 'picocolors';
import { observability, resources, URLS } from './stack';

process.once('SIGINT', () => {
  void resources.app.down().then(() => process.exit(0));
});
process.once('SIGTERM', () => {
  void observability.down().then(() => process.exit(0));
});

await observability.up({ verify: false, renderer: 'listr' });

console.log(`
  ${pc.bold('Emmett observability stack is up')}

  ${pc.cyan('App')}        ${resources.app.endpoint()}
  ${pc.cyan('Grafana')}    ${URLS.grafana}
  ${pc.cyan('Prometheus')} ${URLS.prometheus}
  ${pc.cyan('Tempo')}      ${URLS.tempo}
  ${pc.cyan('Loki')}       ${URLS.loki}

  ${pc.dim('tip: every command response carries an x-trace-id header — paste it into Tempo.')}
  ${pc.dim('Ctrl-C stops the app and leaves the stack warm.')}
`);
