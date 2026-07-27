// Runs `handler` once on the first SIGINT/SIGTERM, then exits — so entry points
// never wire signals themselves and Ctrl-C tears the stack down gracefully.
export const onShutdown = (handler: () => Promise<void>): void => {
  let handling = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (handling) return;
    handling = true;
    void (async () => {
      console.log(`\n▶ ${signal} — shutting the stack down…`);
      await handler();
      process.exit(0);
    })();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
};
