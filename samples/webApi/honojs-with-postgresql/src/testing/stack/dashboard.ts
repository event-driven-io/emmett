import pc from 'picocolors';

// The stack's "dashboard": the endpoints + tips printed once the stack is up.
export type Dashboard = {
  title?: string;
  endpoints: Record<string, string>;
  tips?: string[];
};

// Renders the stack's dashboard once it's up: the endpoint table and any tips.
export const renderDashboard = (dashboard: Dashboard): void => {
  const width = Math.max(
    ...Object.keys(dashboard.endpoints).map((k) => k.length),
  );
  const lines = Object.entries(dashboard.endpoints).map(
    ([label, url]) => `  ${pc.cyan(label.padEnd(width))}  ${url}`,
  );
  const tips = (dashboard.tips ?? []).map(
    (tip) => `  ${pc.dim(`tip: ${tip}`)}`,
  );

  console.log(
    [
      '',
      dashboard.title ? `  ${pc.bold(dashboard.title)}` : undefined,
      '',
      ...lines,
      tips.length ? '' : undefined,
      ...tips,
      '',
    ]
      .filter((l) => l !== undefined)
      .join('\n'),
  );
};
