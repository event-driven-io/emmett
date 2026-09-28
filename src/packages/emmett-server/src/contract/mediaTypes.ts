export const MediaTypes = {
  JSON: 'application/json',
  HAL: 'application/hal+json',
  HALForms: 'application/prs.hal-forms+json',
  JSONSequence: 'application/json-seq',
  Problem: 'application/problem+json',
  OpenApi: 'application/vnd.oai.openapi+json;version=3.1',
  HTML: 'text/html',
} as const;

export type ResourceMediaType =
  typeof MediaTypes.JSON | typeof MediaTypes.HAL | typeof MediaTypes.HALForms;

export const ResourceMediaTypes: readonly ResourceMediaType[] = [
  MediaTypes.JSON,
  MediaTypes.HAL,
  MediaTypes.HALForms,
];

export const MessagesMediaTypes = [
  ...ResourceMediaTypes,
  MediaTypes.JSONSequence,
] as const;

export type MessagesMediaType = (typeof MessagesMediaTypes)[number];
