type MediaRange = {
  type: string;
  subtype: string;
  quality: number;
  order: number;
};

const parseMediaRanges = (accept: string): MediaRange[] =>
  accept
    .split(',')
    .map((part, order) => {
      const [range, ...parameters] = part.trim().split(';');
      const [type, subtype] = (range ?? '').trim().toLowerCase().split('/');
      const qualityParameter = parameters
        .map((parameter) => parameter.trim().split('='))
        .find(([name]) => name?.trim().toLowerCase() === 'q');
      const quality =
        qualityParameter?.[1] !== undefined
          ? Number(qualityParameter[1].trim())
          : 1;

      return {
        type: type ?? '',
        subtype: subtype ?? '',
        quality: Number.isFinite(quality) ? quality : 0,
        order,
      };
    })
    .filter(({ type, subtype }) => type !== '' && subtype !== '');

const specificity = ({ type, subtype }: MediaRange) =>
  type === '*' ? 0 : subtype === '*' ? 1 : 2;

const matches = (range: MediaRange, mediaType: string) => {
  const [type, subtype] = mediaType.toLowerCase().split('/');

  return (
    (range.type === '*' || range.type === type) &&
    (range.subtype === '*' || range.subtype === subtype)
  );
};

/**
 * Picks the best supported media type for the `Accept` header.
 *
 * Returns the first supported type when `Accept` is absent, and `undefined`
 * when no supported type is acceptable, which maps to `406 Not Acceptable`.
 */
export const negotiateMediaType = <MediaType extends string>(
  accept: string | null | undefined,
  supported: readonly MediaType[],
): MediaType | undefined => {
  if (!accept || accept.trim() === '') return supported[0];

  const ranges = parseMediaRanges(accept);

  let best:
    { mediaType: MediaType; quality: number; rank: number[] } | undefined;

  supported.forEach((mediaType, supportedOrder) => {
    const range = ranges
      .filter((r) => matches(r, mediaType))
      .sort((a, b) => specificity(b) - specificity(a) || a.order - b.order)[0];

    if (!range || range.quality <= 0) return;

    const rank = [
      range.quality,
      specificity(range),
      -range.order,
      -supportedOrder,
    ];

    if (!best || compareRanks(rank, best.rank) > 0)
      best = { mediaType, quality: range.quality, rank };
  });

  return best?.mediaType;
};

const compareRanks = (a: number[], b: number[]): number => {
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!;
    if (diff !== 0) return diff;
  }
  return 0;
};

/**
 * Checks whether a `Content-Type` header value denotes JSON,
 * i.e. `application/json` or any `+json` structured syntax suffix.
 */
export const isJSONContentType = (contentType: string | null | undefined) => {
  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase();

  return (
    mediaType !== undefined &&
    (mediaType === 'application/json' ||
      (mediaType.startsWith('application/') && mediaType.endsWith('+json')))
  );
};
