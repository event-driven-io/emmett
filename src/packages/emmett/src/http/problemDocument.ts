import { httpStatusReasonPhrases } from './statusCodes';

export type ProblemDocumentOptions = {
  type?: string;
  title?: string;
  detail?: string;
  instance?: string;
  status: number;
};

const standardMembers = new Set<string>([
  'type',
  'title',
  'status',
  'detail',
  'instance',
]);

export class ProblemDocument {
  [key: string]: unknown;

  public type: string;
  declare public title?: string;
  public status: number;
  declare public detail?: string;
  declare public instance?: string;

  constructor(
    options: ProblemDocumentOptions,
    extensions?: Record<string, unknown>,
  ) {
    this.type = options.type ?? 'about:blank';

    const title = options.title ?? httpStatusReasonPhrases[options.status];
    if (title !== undefined) this.title = title;

    this.status = options.status;

    if (options.detail !== undefined) this.detail = options.detail;
    if (options.instance !== undefined) this.instance = options.instance;

    for (const [name, value] of Object.entries(extensions ?? {})) {
      if (!standardMembers.has(name)) this[name] = value;
    }
  }
}
