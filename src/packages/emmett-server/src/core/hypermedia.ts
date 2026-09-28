import {
  EmmettCurie,
  EventStoreApiProfile,
  EmmettDocumentationBaseUrl,
  MediaTypes,
  Relations,
} from '../contract';

export type Link = {
  href: string;
  templated?: boolean;
  type?: string;
  title?: string;
};

export type Links = Record<string, Link | Link[] | (typeof EmmettCurie)[]>;

export const withCuries = (links: Record<string, Link | undefined>): Links => ({
  ...(Object.fromEntries(
    Object.entries(links).filter(([, link]) => link !== undefined),
  ) as Record<string, Link>),
  curies: [EmmettCurie],
});

const query = (
  parameters: Record<string, string | number | bigint | undefined>,
) => {
  const search = new URLSearchParams();

  for (const [name, value] of Object.entries(parameters))
    if (value !== undefined) search.set(name, value.toString());

  const text = search.toString();

  return text ? `?${text}` : '';
};

/**
 * Builds URLs relative to the effective API root, so links follow the configured mount path.
 */
export const apiLinks = (apiRoot: string) => {
  const root = apiRoot || '/';
  const streams = `${apiRoot}/streams`;
  const stream = (streamName: string) =>
    `${streams}/${encodeURIComponent(streamName)}`;
  const messages = (streamName: string) => `${stream(streamName)}/messages`;

  return {
    root,
    openApi: `${apiRoot}/openapi.json`,
    docs: `${apiRoot}/docs`,
    streams: (parameters?: Record<string, string | number | undefined>) =>
      `${streams}${query(parameters ?? {})}`,
    streamsSearchTemplate: `${streams}{?q,streamType,limit}`,
    stream,
    messages: (
      streamName: string,
      parameters?: Record<string, string | number | bigint | undefined>,
    ) => `${messages(streamName)}${query(parameters ?? {})}`,
    messagesTemplate: (streamName: string) =>
      `${messages(streamName)}{?from,to,limit}`,
  };
};

export type ApiLinks = ReturnType<typeof apiLinks>;

export const halLink = (href: string, type: string = MediaTypes.HAL): Link => ({
  href,
  type,
});

export const profileLink = (fragment?: string): Link => ({
  href: fragment ? `${EventStoreApiProfile}#${fragment}` : EventStoreApiProfile,
});

export const appendTemplate = (target: string) => ({
  append: {
    title: 'Append messages',
    method: 'POST',
    target,
    contentType: MediaTypes.JSON,
    properties: [{ name: 'messages', required: true, type: 'array' }],
  },
});

export const RelationDocumentation = `${EmmettDocumentationBaseUrl}/rels`;

export { Relations };
