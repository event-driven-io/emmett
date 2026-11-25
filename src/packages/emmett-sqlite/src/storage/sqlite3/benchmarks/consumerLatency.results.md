# Consumer latency

`npm run bench:consumer-latency` measures how long a message waits between its append and its handler in a SQLite consumer. The consumer polls every 20 ms. First, one message arrives every 30 ms (the first 20 of 100 are skipped as warm-up). Then single messages arrive after 3000 to 3875 ms of idle time.

Before: 0.43.0-rc.3, where a read that found fewer messages than the batch size counted as idle, so the wait kept doubling up to 1 s while messages kept flowing. On this version, the `backoff` option does not exist, so the last configuration runs with the default backoff. After: reads that find messages reset the wait to the polling frequency, and `pulling.backoff` is configurable.

Measured on Linux 6.18 (WSL2), Node.js 24, sqlite3 driver.

| Configuration                                                   | Scenario       | Before p50 / p95 / max | After p50 / p95 / max |
| --------------------------------------------------------------- | -------------- | ---------------------- | --------------------- |
| `batchSize: 100`, default backoff                               | steady trickle | 519 / 992 / 1046 ms    | 50 / 90 / 92 ms       |
| `batchSize: 100`, default backoff                               | after idle     | 627 / 1009 / 1009 ms   | 640 / 1012 / 1012 ms  |
| `batchSize: 1`, default backoff                                 | steady trickle | 33 / 184 / 215 ms      | 31 / 176 / 208 ms     |
| `batchSize: 1`, default backoff                                 | after idle     | 523 / 893 / 893 ms     | 522 / 902 / 902 ms    |
| `batchSize: 100`, `backoff.maxInMs: 20`, `batchDeadlineInMs: 0` | steady trickle | 495 / 966 / 1007 ms    | 17 / 25 / 26 ms       |
| `batchSize: 100`, `backoff.maxInMs: 20`, `batchDeadlineInMs: 0` | after idle     | 626 / 1004 / 1004 ms   | 20 / 25 / 25 ms       |

After idle time, the default backoff still waits up to 1 s by design. Set `backoff.maxInMs` to bound it.
