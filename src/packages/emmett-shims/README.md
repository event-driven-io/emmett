# @event-driven-io/emmett-shims

Runtime environment detection and Web Streams polyfills for cross-platform compatibility across Node.js, Bun, Deno, browsers, and web workers.

## Purpose

This package provides two core capabilities for the Emmett event sourcing ecosystem:

1. **Runtime Environment Detection** - Functions to identify the current JavaScript runtime environment, enabling conditional logic based on where your code is executing.

2. **Web Streams Polyfill** - Automatic detection and fallback for Web Streams API support, ensuring consistent stream behavior across all platforms.

## Key Concepts

### Environment Detection

The package exports functions to detect various JavaScript runtime environments:

- **Node.js** - Server-side JavaScript runtime
- **Bun** - Fast all-in-one JavaScript runtime
- **Deno** - Secure runtime for JavaScript and TypeScript
- **Browser** - Standard web browser environment
- **Web Worker** - Dedicated worker threads in browsers
- **jsdom** - JavaScript implementation of web standards for testing

### Streams Polyfill

Web Streams (`ReadableStream`, `WritableStream`, `TransformStream`) are used throughout Emmett for event subscriptions and data processing. This package:

- Checks if native streams are available via `globalThis`
- Falls back to `web-streams-polyfill` when native support is missing
- Exports a unified streams object that works consistently across platforms

## Installation

```bash
npm install @event-driven-io/emmett-shims web-streams-polyfill
```

Note: `web-streams-polyfill` is a peer dependency and must be installed alongside this package.

## Quick Start

### Environment Detection

```typescript
import {
  isNode,
  isBrowser,
  isBun,
  isDeno,
  isWebWorker,
  isJsDom,
} from '@event-driven-io/emmett-shims';

// Detect current runtime
if (isNode()) {
  console.log('Running in Node.js');
}

if (isBrowser()) {
  console.log('Running in a browser');
}

if (isBun) {
  // Note: isBun is a boolean, not a function
  console.log('Running in Bun');
}

if (isDeno()) {
  console.log('Running in Deno');
}

if (isWebWorker()) {
  console.log('Running in a Web Worker');
}

if (isJsDom()) {
  console.log('Running in jsdom (testing environment)');
}
```

### Using Streams

```typescript
import streams from '@event-driven-io/emmett-shims';

const { ReadableStream, WritableStream, TransformStream } = streams;

// Create a readable stream
const readable = new ReadableStream({
  start(controller) {
    controller.enqueue('Hello');
    controller.enqueue('World');
    controller.close();
  },
});

// Create a transform stream
const transform = new TransformStream({
  transform(chunk, controller) {
    controller.enqueue(chunk.toUpperCase());
  },
});

// Pipe streams together
const result = readable.pipeThrough(transform);
```

### Type Imports

```typescript
import type {
  ReadableStream,
  WritableStream,
  TransformStream,
} from '@event-driven-io/emmett-shims';
```

## API Reference

### Environment Detection Functions

| Export          | Type            | Description                                         |
| --------------- | --------------- | --------------------------------------------------- |
| `isNode()`      | `() => boolean` | Returns `true` if running in Node.js                |
| `isBun`         | `boolean`       | `true` if running in Bun (evaluated at module load) |
| `isDeno()`      | `() => boolean` | Returns `true` if running in Deno                   |
| `isBrowser()`   | `() => boolean` | Returns `true` if running in a browser              |
| `isWebWorker()` | `() => boolean` | Returns `true` if running in a Web Worker           |
| `isJsDom()`     | `() => boolean` | Returns `true` if running in jsdom                  |

### Streams (Default Export)

The default export is an object containing the stream constructors:

```typescript
{
  ReadableStream: typeof ReadableStream;
  WritableStream: typeof WritableStream;
  TransformStream: typeof TransformStream;
}
```

These are either native implementations (when available) or polyfilled versions from `web-streams-polyfill`.

### Type Exports

All types from `web-streams-polyfill` are re-exported for TypeScript users.

## Dependencies

### Peer Dependencies

| Package                | Version | Purpose                                                                   |
| ---------------------- | ------- | ------------------------------------------------------------------------- |
| `web-streams-polyfill` | ^4.0.0  | Provides Web Streams API polyfill for environments without native support |

### Why Peer Dependency?

The `web-streams-polyfill` is a peer dependency to:

- Avoid duplicate polyfill instances in your bundle
- Allow you to control the exact version used
- Reduce bundle size when native streams are available
