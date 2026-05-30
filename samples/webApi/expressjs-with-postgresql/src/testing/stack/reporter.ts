import { Listr, type ListrTask } from 'listr2';
import type { Resource } from './types';

// Mirrors the resource tree as a Listr task tree: composites become task groups
// (concurrent for `parallel`), leaves run their own up(). Rendering is scoped to
// bring-up — the default console reporter (plain up()) stays the fallback.
const toTasks = (resources: Resource[]): ListrTask[] =>
  resources.map((resource) => ({
    title: resource.name,
    task: (_ctx, task) =>
      resource.children
        ? task.newListr(toTasks(resource.children), {
            concurrent: resource.mode === 'parallel',
          })
        : resource.up({ verify: false }),
  }));

export const listrUp = async (root: Resource): Promise<void> => {
  const children = root.children ?? [root];
  await new Listr(toTasks(children), {
    concurrent: root.mode === 'parallel',
  }).run();
};
