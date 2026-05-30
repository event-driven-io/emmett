import { Listr, type ListrTask } from 'listr2';
import type { Resource } from './types';

// Mirrors the resource tree as a Listr task tree: composites become task groups
// (concurrent for `parallel`), leaves run their own up(). Rendering is scoped to
// bring-up — the default console reporter (plain up()) stays the fallback.
const toTasks = (
  resources: Resource[],
  opts: { debug?: boolean },
): ListrTask[] =>
  resources.map((resource) => ({
    title: resource.name,
    task: (_ctx, task) =>
      resource.children
        ? task.newListr(toTasks(resource.children, opts), {
            concurrent: resource.mode === 'parallel',
          })
        : resource.up({ skipVerification: true, debug: opts.debug }),
  }));

export const listrUp = async (
  root: Resource,
  opts: { debug?: boolean } = {},
): Promise<void> => {
  const children = root.children ?? [root];
  await new Listr(toTasks(children, opts), {
    concurrent: root.mode === 'parallel',
  }).run();
};
