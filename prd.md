## Goal

Add observability based on the Open Telemetry standard, but not require to use it as it may bring some performance issues. Add small, opinionated abstractions that will allow plugging different popular tools like Pino, Watson, but don't be lowest common denominator and plug it to event stores implementation and command handling.

The obvious wins, and starting point is adding observability like:
- command handling metrics,
- event store operations,
- but also contextual based on command name, events etc. 
- Events could be possibly stored as span events (or other way)

## Abstraction

The lightweight abstraction should also allow plugging to e.g. pass the result to databases like DuckDB or Clickhouse to do advanced analysis as paid pluggin. Or to some vector dbs. Don't implement those providers, that's day two issues, just make it possible. It should also just allow printing and storing.

The current, naive implementation is in: [tracer.ts](./src/packages/emmett/src/observability/tracer.ts)

It's based on: https://jeremymorrell.dev/blog/minimal-js-tracing/

I want it to be pluggable and setup just like serialization options in the previous commits.

Now, I want to keep tracer as simple as possible, but also pluggable.

I also want to use latest standards as wide events, and make it pluggable with modern tooling like weaver https://github.com/open-telemetry/weaver

Eventually I want to also build a dashboard and have setup as .NET Aspire (thus pluggable exporter).

I don't want to do custom work if it's not needed, just reuse the best approaches and standards, so abstraction is more to allow pluggability when new libraries, or apis change. And to make easier using those apis inside emmett.

## Inspiration

I did some older work in this are, which I copy pasted from the past, it shows how I did command handling, defined metrics etc.

## Articles to read and research
- https://jeremymorrell.dev/blog/minimal-js-tracing/
- https://jeremymorrell.dev/blog/a-practitioners-guide-to-wide-events/
- https://isburmistrov.substack.com/p/all-you-need-is-wide-events-not-metrics
- https://boristane.com/blog/observability-wide-events-101/
- https://charity.wtf/2024/08/07/is-it-time-to-version-observability-signs-point-to-yes/