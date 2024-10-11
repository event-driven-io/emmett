import streams, { type ReadableStream } from '@event-driven-io/emmett-shims';
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { assertEqual } from '../testing';
import type { DefaultRecord } from '../typing';
import { collect } from './collectors/collect';
import { DefaultDecoder } from './decoders/composite';
import { JsonDecoder } from './decoders/json';
import { restream } from './restream';

type TransformedObject = DefaultRecord & { transformed: true };

// Helper function to create a mock source stream for JSON data with chunk splitting
const MAX_CHUNK_SIZE = 1024; // Define a maximum chunk size for splitting

function createChunkedJsonSourceStream(
  objects: DefaultRecord[],
): ReadableStream<string> {
  return new streams.ReadableStream({
    start(controller) {
      try {
        for (const obj of objects) {
          const jsonString = JSON.stringify(obj) + '\n';
          // Split large JSON strings into smaller chunks
          for (let i = 0; i < jsonString.length; i += MAX_CHUNK_SIZE) {
            controller.enqueue(jsonString.slice(i, i + MAX_CHUNK_SIZE));
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

// Helper function to create a mock source stream for binary data with chunk splitting
function createChunkedBinarySourceStream(
  objects: DefaultRecord[],
): ReadableStream<Uint8Array> {
  return new streams.ReadableStream({
    start(controller) {
      try {
        for (const obj of objects) {
          const encoded = new TextEncoder().encode(JSON.stringify(obj) + '\n'); // Ensure each object ends with a newline
          // Split large binary data into smaller chunks
          for (let i = 0; i < encoded.length; i += MAX_CHUNK_SIZE) {
            controller.enqueue(encoded.slice(i, i + MAX_CHUNK_SIZE));
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

// Helper function to create a mock source stream in object mode
function createObjectModeSourceStream(
  objects: DefaultRecord[],
): ReadableStream<DefaultRecord> {
  return new streams.ReadableStream({
    start(controller) {
      try {
        for (const obj of objects) {
          controller.enqueue(obj); // Directly enqueue the object
        }
        controller.close(); // Close the stream after all data is enqueued
      } catch (error) {
        controller.error(error); // Signal an error if any occurs
      }
    },
  });
}

// Helper function to collect all data from a readable stream

// Tests
void describe('restreamer', () => {
  void it('basic transformation with JSON stream', async () => {
    const objects: DefaultRecord[] = [
      { id: 1, data: 'A'.repeat(1500) },
      { id: 2, data: 'B'.repeat(500) },
    ];

    const restreamer = restream(
      () => createChunkedJsonSourceStream(objects),
      (input: DefaultRecord) =>
        ({ ...input, transformed: true }) as TransformedObject,
      { retries: 3, minTimeout: 25 },
    );

    const results = await collect(restreamer);

    assertEqual(results.length, 2);
    assertEqual(results[0]!.transformed, true);
    assertEqual(results[1]!.transformed, true);
  });

  void it('basic transformation with binary stream', async () => {
    const objects: DefaultRecord[] = [
      { id: 1, data: 'A'.repeat(1500) },
      { id: 2, data: 'B'.repeat(500) },
    ];

    const restreamer = restream(
      () => createChunkedBinarySourceStream(objects),
      (input: DefaultRecord) =>
        ({ ...input, transformed: true }) as TransformedObject,
      { retries: 3, minTimeout: 25 },
    );

    const results = await collect(restreamer);

    assertEqual(results.length, 2);
    assertEqual(results[0]!.transformed, true);
    assertEqual(results[1]!.transformed, true);
  });

  void it('basic transformation with object mode stream', async () => {
    const objects: DefaultRecord[] = [
      { id: 1, data: { key: 'value1' } },
      { id: 2, data: { key: 'value2' } },
    ];

    const restreamer = restream(
      () => createObjectModeSourceStream(objects),
      (input: DefaultRecord) =>
        ({ ...input, transformed: true }) as TransformedObject,
      { retries: 3, minTimeout: 25 }, // Reduced minTimeout for faster testing
    );
    const results = await collect(restreamer);

    assertEqual(results.length, 2);
    assertEqual(results[0]!.transformed, true);
    assertEqual(results[1]!.transformed, true);
  });

  void it('handles empty stream', async () => {
    const objects: DefaultRecord[] = [];

    const restreamer = restream(
      () => createChunkedJsonSourceStream(objects),
      (input: DefaultRecord) =>
        ({ ...input, transformed: true }) as TransformedObject,
      { retries: 3, minTimeout: 25 },
    );
    const results = await collect(restreamer);

    assertEqual(results.length, 0);
  });

  void it('handles error in the source stream', async () => {
    const objects: DefaultRecord[] = [
      { id: 1, data: 'A'.repeat(1500) },
      { id: 2, data: 'B'.repeat(500) },
    ];

    // Stream factory to create a new stream for each retry
    const sourceStreamFactory = (): ReadableStream<DefaultRecord> => {
      return new streams.ReadableStream<DefaultRecord>({
        start(controller) {
          try {
            for (const obj of objects) {
              controller.enqueue(obj);
            }
            // Inject an error after enqueuing some data
            throw new Error('Source stream error');
          } catch (error) {
            controller.error(error);
          }
        },
      });
    };

    const restreamer = restream(
      sourceStreamFactory, // Factory function to create a new stream for each attempt
      (input: DefaultRecord) =>
        ({ ...input, transformed: true }) as TransformedObject,
      { retries: 1, minTimeout: 25 }, // Retry options: minimal minTimeout for testing
    );

    try {
      await collect(restreamer);
      assert.fail('Expected an error during stream processing');
    } catch (error) {
      assertEqual((error as Error).message, 'Source stream error');
    }
  });

  void it('handles closing the source stream midway', async () => {
    const objects: DefaultRecord[] = [
      { id: 1, data: 'A'.repeat(1500) },
      { id: 2, data: 'B'.repeat(500) },
      { id: 3, data: 'C'.repeat(1000) }, // This will not be fully sent
    ];

    const sourceStream = new streams.ReadableStream<DefaultRecord>({
      start(controller) {
        try {
          for (let i = 0; i < objects.length; i++) {
            if (i === 2) {
              // Close the stream before sending the last object
              controller.close();
              break;
            }
            controller.enqueue(objects[i]!);
          }
        } catch (error) {
          controller.error(error);
        }
      },
    });

    const restreamer = restream(
      () => sourceStream,
      (input: DefaultRecord) =>
        ({ ...input, transformed: true }) as TransformedObject,
      { retries: 3, minTimeout: 25 }, // Retry options
    );
    const results = await collect(restreamer);

    // Should only have 2 transformed objects
    assertEqual(results.length, 2);
    assertEqual(results[0]!.transformed, true);
    assertEqual(results[1]!.transformed, true);
  });

  void it('recovers from transient error in source stream', async () => {
    const objects: DefaultRecord[] = [
      { id: 1, data: 'A'.repeat(1500) },
      { id: 2, data: 'B'.repeat(500) },
    ];

    let attempt = 0;

    const sourceStreamFactory = (): ReadableStream<DefaultRecord> => {
      return new streams.ReadableStream<DefaultRecord>({
        start(controller) {
          attempt++;
          try {
            if (attempt < 3) {
              // Simulate a transient error on first two attempts
              throw new Error('Transient error');
            }
            for (const obj of objects) {
              controller.enqueue(obj);
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });
    };

    const restreamer = restream(
      sourceStreamFactory,
      (input: DefaultRecord) =>
        ({ ...input, transformed: true }) as TransformedObject,
      { retries: 5, minTimeout: 25 }, // Retry options to handle transient errors
    );
    const results = await collect(restreamer);

    // Should successfully recover and process all objects after retries
    assertEqual(results.length, 2);
    assertEqual(results[0]!.transformed, true);
    assertEqual(results[1]!.transformed, true);
  });

  void it('handles minTimeouted stream closure', async () => {
    const objects: DefaultRecord[] = [
      { id: 1, data: 'A'.repeat(1500) },
      { id: 2, data: 'B'.repeat(500) },
    ];

    const sourceStream = new streams.ReadableStream<DefaultRecord>({
      start(controller) {
        let index = 0;
        function push() {
          if (index < objects.length) {
            controller.enqueue(objects[index++]!);
            setTimeout(push, 25); // Short minTimeout between enqueues for testing
          } else {
            controller.close();
          }
        }
        push();
      },
    });

    const restreamer = restream(
      () => sourceStream,
      (input: DefaultRecord) =>
        ({ ...input, transformed: true }) as TransformedObject,
      { retries: 3, minTimeout: 25 }, // Retry options
    );
    const results = await collect(restreamer);

    // Should handle minTimeouted closure correctly
    assertEqual(results.length, 2);
    assertEqual(results[0]!.transformed, true);
    assertEqual(results[1]!.transformed, true);
  });

  void it('handles rapid stream closure after enqueuing', async () => {
    const objects: DefaultRecord[] = [
      { id: 1, data: 'A'.repeat(1500) },
      { id: 2, data: 'B'.repeat(500) },
    ];

    const sourceStream = new streams.ReadableStream<DefaultRecord>({
      start(controller) {
        try {
          for (const obj of objects) {
            controller.enqueue(obj);
          }
          controller.close(); // Immediately close after enqueuing
        } catch (error) {
          controller.error(error);
        }
      },
    });

    const restreamer = restream(
      () => sourceStream,
      (input: DefaultRecord) =>
        ({ ...input, transformed: true }) as TransformedObject,
      { retries: 3, minTimeout: 25 }, // Retry options
    );
    const results = await collect(restreamer);

    // Should handle rapid closure correctly
    assertEqual(results.length, 2);
    assertEqual(results[0]!.transformed, true);
    assertEqual(results[1]!.transformed, true);
  });

  void it('handles rapid stream closure after enqueuing', async () => {
    const objects: DefaultRecord[] = [
      { id: 1, data: 'A'.repeat(1500) },
      { id: 2, data: 'B'.repeat(500) },
    ];

    const sourceStream = new streams.ReadableStream<DefaultRecord>({
      start(controller) {
        try {
          for (const obj of objects) {
            controller.enqueue(obj);
          }
          controller.close(); // Immediately close after enqueuing
        } catch (error) {
          controller.error(error);
        }
      },
    });

    const restreamer = restream(
      () => sourceStream,
      (input: DefaultRecord) =>
        ({ ...input, transformed: true }) as TransformedObject,
      { retries: 3, minTimeout: 25 }, // Retry options
    );
    const results = await collect(restreamer);

    // Should handle rapid closure correctly
    assertEqual(results.length, 2);
    assertEqual(results[0]!.transformed, true);
    assertEqual(results[1]!.transformed, true);
  });

  void it('handles rapid stream closure after enqueuing', async () => {
    const objects: DefaultRecord[] = [
      { id: 1, data: 'A'.repeat(1500) },
      { id: 2, data: 'B'.repeat(500) },
    ];

    const sourceStream = new streams.ReadableStream<DefaultRecord>({
      start(controller) {
        try {
          for (const obj of objects) {
            controller.enqueue(obj);
          }
          controller.close(); // Immediately close after enqueuing
        } catch (error) {
          controller.error(error);
        }
      },
    });

    const restreamer = restream(
      () => sourceStream,
      (input: DefaultRecord) =>
        ({ ...input, transformed: true }) as TransformedObject,
      { retries: 3, minTimeout: 25 }, // Retry options
    );
    const results = await collect(restreamer);

    // Should handle rapid closure correctly
    assertEqual(results.length, 2);
    assertEqual(results[0]!.transformed, true);
    assertEqual(results[1]!.transformed, true);
  });

  void it('handles rapid stream closure after enqueuing', async () => {
    const objects: DefaultRecord[] = [
      { id: 1, data: 'A'.repeat(1500) },
      { id: 2, data: 'B'.repeat(500) },
    ];

    const sourceStream = new streams.ReadableStream<DefaultRecord>({
      start(controller) {
        try {
          for (const obj of objects) {
            controller.enqueue(obj);
          }
          controller.close(); // Immediately close after enqueuing
        } catch (error) {
          controller.error(error);
        }
      },
    });

    const restreamer = restream(
      () => sourceStream,
      (input: DefaultRecord) =>
        ({ ...input, transformed: true }) as TransformedObject,
      { retries: 3, minTimeout: 25 }, // Retry options
    );
    const results = await collect(restreamer);

    // Should handle rapid closure correctly
    assertEqual(results.length, 2);
    assertEqual(results[0]!.transformed, true);
    assertEqual(results[1]!.transformed, true);
  });

  void it('handles rapid stream closure after enqueuing', async () => {
    const objects: DefaultRecord[] = [
      { id: 1, data: 'A'.repeat(1500) },
      { id: 2, data: 'B'.repeat(500) },
    ];

    const sourceStream = new streams.ReadableStream<DefaultRecord>({
      start(controller) {
        try {
          for (const obj of objects) {
            controller.enqueue(obj);
          }
          controller.close(); // Immediately close after enqueuing
        } catch (error) {
          controller.error(error);
        }
      },
    });

    const restreamer = restream(
      () => sourceStream,
      (input: DefaultRecord) =>
        ({ ...input, transformed: true }) as TransformedObject,
      { retries: 3, minTimeout: 25 }, // Retry options
    );
    const results = await collect(restreamer);

    // Should handle rapid closure correctly
    assertEqual(results.length, 2);
    assertEqual(results[0]!.transformed, true);
    assertEqual(results[1]!.transformed, true);
  });

  void describe('additional edge cases', () => {
    void it('handles a large single chunk', async () => {
      const largeData = { id: 7, data: 'G'.repeat(5000) }; // Large single object
      const sourceStream = createChunkedJsonSourceStream([largeData]);

      const restreamer = restream(
        () => sourceStream,
        (input: DefaultRecord) =>
          ({ ...input, transformed: true }) as TransformedObject,
        {
          retries: 3,
          minTimeout: 25,
        },
      );
      const results = await collect(restreamer);

      assertEqual(results.length, 1);
      assertEqual(results[0]!.transformed, true);
      assertEqual(results[0]!.data, 'G'.repeat(5000));
    });

    void it('handles incomplete final chunk', async () => {
      const incompleteJsonString = JSON.stringify({
        id: 8,
        data: 'H'.repeat(3000),
      }).slice(0, 2000); // Incomplete JSON string

      const sourceStream = new streams.ReadableStream<string>({
        start(controller) {
          // Enqueue the incomplete chunk
          controller.enqueue(incompleteJsonString);
          controller.close();
        },
      });

      const restreamer = restream(
        () => sourceStream,
        (input: DefaultRecord) =>
          ({ ...input, transformed: true }) as TransformedObject,
        {
          retries: 3,
          minTimeout: 25,
        },
        new JsonDecoder(), // Specify the JSON strategy directly
      );

      try {
        await collect(restreamer);
        assert.fail('Expected an error due to incomplete final chunk');
      } catch (error) {
        // Adjust the expected error message to match the actual error thrown
        assert.match(
          (error as Error).message,
          /Unterminated string in JSON at position/,
        );
      }
    });

    void it.skip('handles mixed data types including non-JSON binary', async () => {
      const objects: (DefaultRecord | string | Uint8Array | object)[] = [
        { id: 1, data: 'Mixed data 1' }, // JSON object
        'Non-standard string data\n', // String data ending with a newline
        new Uint8Array([72, 101, 108, 108, 111]), // Binary data for "Hello" (no JSON delimiter needed)
        new Uint8Array([
          123, 34, 105, 100, 34, 58, 50, 44, 34, 100, 97, 116, 97, 34, 58, 34,
          77, 105, 120, 101, 100, 32, 100, 97, 116, 97, 32, 50, 34, 125, 10,
        ]), // Binary encoded JSON with a newline: { "id": 2, "data": "Mixed data 2" }
      ];

      const mixedSourceStream = new streams.ReadableStream<unknown>({
        start(controller) {
          try {
            for (const obj of objects) {
              if (typeof obj === 'string') {
                controller.enqueue(obj);
              } else if (obj instanceof Uint8Array) {
                controller.enqueue(obj);
              } else if (typeof obj === 'object') {
                controller.enqueue(JSON.stringify(obj) + '\n'); // Add newline to JSON objects
              }
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });

      const restreamer = restream(
        () => mixedSourceStream,
        (input: DefaultRecord) => ({ ...input, transformed: true }),
        { retries: 3, minTimeout: 25 },
        new DefaultDecoder(), // Use the default strategy to handle mixed data types
      );
      const results = await collect(restreamer);

      // Ensure that the mixed data types are processed correctly
      assertEqual(results.length, 4);
      assertEqual(results[0]!.transformed, true);
      assertEqual(results[1]!.transformed, true);
      assertEqual(results[2]!.transformed, true);
      assertEqual(results[3]!.transformed, true);
    });

    void it('handles frequent transient errors in source stream', async () => {
      const objects: DefaultRecord[] = [
        { id: 9, data: 'I'.repeat(1500) },
        { id: 10, data: 'J'.repeat(500) },
      ];

      let attempt = 0;

      const sourceStreamFactory = (): ReadableStream<DefaultRecord> => {
        return new streams.ReadableStream<DefaultRecord>({
          start(controller) {
            attempt++;
            try {
              if (attempt < 5) {
                // Simulate frequent transient errors
                throw new Error('Frequent transient error');
              }
              for (const obj of objects) {
                controller.enqueue(obj);
              }
              controller.close();
            } catch (error) {
              controller.error(error);
            }
          },
        });
      };

      const restreamer = restream(
        sourceStreamFactory,
        (input: DefaultRecord) =>
          ({ ...input, transformed: true }) as TransformedObject,
        { retries: 5, minTimeout: 25 }, // More retries to handle frequent errors
      );
      const results = await collect(restreamer);

      assertEqual(results.length, 2);
      assertEqual(results[0]!.transformed, true);
      assertEqual(results[1]!.transformed, true);
    });

    void it('handles data arrival after a significant minTimeout', async () => {
      const minTimeoutedData = [
        { id: 11, data: 'K'.repeat(1000) },
        { id: 12, data: 'L'.repeat(500) },
      ];

      const sourceStream = new streams.ReadableStream<DefaultRecord>({
        start(controller) {
          setTimeout(() => {
            try {
              for (const obj of minTimeoutedData) {
                controller.enqueue(obj);
              }
              controller.close();
            } catch (error) {
              controller.error(error);
            }
          }, 1000); // minTimeout data arrival by 1 second
        },
      });

      const restreamer = restream(
        () => sourceStream,
        (input: DefaultRecord) =>
          ({ ...input, transformed: true }) as TransformedObject,
        {
          retries: 3,
          minTimeout: 25,
        },
      );
      const results = await collect(restreamer);

      assertEqual(results.length, 2);
      assertEqual(results[0]!.transformed, true);
      assertEqual(results[1]!.transformed, true);
    });

    void it('handles unrecoverable errors in source stream', async () => {
      const sourceStream = new streams.ReadableStream<DefaultRecord>({
        start(controller) {
          try {
            throw new Error('Unrecoverable stream error');
          } catch (error) {
            controller.error(error);
          }
        },
      });

      const restreamer = restream(
        () => sourceStream,
        (input: DefaultRecord) =>
          ({ ...input, transformed: true }) as TransformedObject,
        {
          retries: 1,
          minTimeout: 25,
        },
      );

      try {
        await collect(restreamer);
        assert.fail('Expected an unrecoverable error');
      } catch (error) {
        assertEqual((error as Error).message, 'Unrecoverable stream error');
      }
    });

    void it('handles stream backpressure gracefully', async () => {
      const objects: DefaultRecord[] = [
        { id: 13, data: 'M'.repeat(1500) },
        { id: 14, data: 'N'.repeat(500) },
      ];

      const sourceStream = new streams.ReadableStream<DefaultRecord>({
        start(controller) {
          try {
            for (const obj of objects) {
              controller.enqueue(obj);
              // Simulate backpressure by introducing a minTimeout
              setTimeout(() => {}, 100);
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });

      const restreamer = restream(
        () => sourceStream,
        (input: DefaultRecord) =>
          ({ ...input, transformed: true }) as TransformedObject,
        { retries: 3, minTimeout: 25 },
      );
      const results = await collect(restreamer);

      assertEqual(results.length, 2);
      assertEqual(results[0]!.transformed, true);
      assertEqual(results[1]!.transformed, true);
    });

    void it('handles a large number of small items', async () => {
      const objects: DefaultRecord[] = Array.from(
        { length: 10000 },
        (_, i) => ({
          id: i,
          data: `Item ${i}`,
        }),
      );

      const restreamer = restream(
        () => createChunkedJsonSourceStream(objects),
        (input: DefaultRecord) =>
          ({ ...input, transformed: true }) as TransformedObject,
        { retries: 3, minTimeout: 25 },
      );
      const results = await collect(restreamer);

      assertEqual(results.length, 10000);
      assert(results.every((item) => item.transformed === true));
    });

    void it('handles varying chunk sizes', async () => {
      const objects: DefaultRecord[] = [
        { id: 1, data: 'A'.repeat(500) },
        { id: 2, data: 'B'.repeat(1500) }, // Larger than default chunk size
        { id: 3, data: 'C'.repeat(2000) }, // Much larger
      ];

      const restreamer = restream(
        () => createChunkedJsonSourceStream(objects),
        (input: DefaultRecord) =>
          ({ ...input, transformed: true }) as TransformedObject,
        { retries: 3, minTimeout: 25 },
      );
      const results = await collect(restreamer);

      assertEqual(results.length, 3);
      assertEqual(results[0]!.transformed, true);
      assertEqual(results[1]!.transformed, true);
      assertEqual(results[2]!.transformed, true);
    });

    void it('handles very large single objects', async () => {
      const largeObject = {
        id: 1,
        data: 'A'.repeat(100000), // Very large string data
      };

      const restreamer = restream(
        () => createChunkedJsonSourceStream([largeObject]),
        (input: DefaultRecord) =>
          ({ ...input, transformed: true }) as TransformedObject,
        { retries: 3, minTimeout: 25 },
      );
      const results = await collect(restreamer);

      assertEqual(results.length, 1);
      assertEqual(results[0]!.transformed, true);
    });
    void it('handles sparse data', async () => {
      const objects: (DefaultRecord | null)[] = [
        { id: 1, data: 'Sparse item 1' },
        null,
        { id: 2, data: 'Sparse item 2' },
        null,
      ];

      const sparseSourceStream =
        new streams.ReadableStream<DefaultRecord | null>({
          start(controller) {
            try {
              for (const obj of objects) {
                controller.enqueue(obj);
              }
              controller.close();
            } catch (error) {
              controller.error(error);
            }
          },
        });

      const restreamer = restream(
        () => sparseSourceStream,
        (input: DefaultRecord) =>
          ({ ...input, transformed: true }) as TransformedObject,
        { retries: 3, minTimeout: 25 },
      );
      const results = await collect(restreamer);

      assertEqual(results.length, 2); // Only two valid objects
      assertEqual(results[0]!.transformed, true);
      assertEqual(results[1]!.transformed, true);
    });
    void it('handles rapid successive chunks', async () => {
      const objects: DefaultRecord[] = [
        { id: 1, data: 'Quick data 1' },
        { id: 2, data: 'Quick data 2' },
      ];

      const sourceStream = new streams.ReadableStream<DefaultRecord>({
        start(controller) {
          try {
            for (const obj of objects) {
              controller.enqueue(obj);
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });

      const restreamer = restream(
        () => sourceStream,
        (input: DefaultRecord) =>
          ({ ...input, transformed: true }) as TransformedObject,
        { retries: 3, minTimeout: 25 },
      );
      const results = await collect(restreamer);

      assertEqual(results.length, 2);
      assertEqual(results[0]!.transformed, true);
      assertEqual(results[1]!.transformed, true);
    });

    void it('handles slow data arrival', async () => {
      const objects: DefaultRecord[] = [
        { id: 1, data: 'Slow data 1' },
        { id: 2, data: 'Slow data 2' },
      ];

      const sourceStream = new streams.ReadableStream<DefaultRecord>({
        start(controller) {
          let index = 0;
          function push() {
            if (index < objects.length) {
              controller.enqueue(objects[index++]!);
              setTimeout(push, 1000); // minTimeout between enqueues
            } else {
              controller.close();
            }
          }
          push();
        },
      });

      const restreamer = restream(
        () => sourceStream,
        (input: DefaultRecord) =>
          ({ ...input, transformed: true }) as TransformedObject,
        { retries: 3, minTimeout: 25 },
      );
      const results = await collect(restreamer);

      assertEqual(results.length, 2);
      assertEqual(results[0]!.transformed, true);
      assertEqual(results[1]!.transformed, true);
    });
  });
});
