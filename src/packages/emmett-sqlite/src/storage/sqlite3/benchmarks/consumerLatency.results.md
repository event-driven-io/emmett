# Consumer latency

`npm run bench:consumer-latency` measures how long a message waits between its append and its handler in a SQLite consumer. The consumer polls every 20 ms. First, one message arrives every 30 ms (the first 20 of 100 are skipped as warm-up). Then single messages arrive after 3000 to 3875 ms of idle time.

- Before: 0.43.0-rc.3. A read that found fewer messages than the batch size counted as idle, so the wait kept doubling up to 1 s while messages kept flowing. The `backoff` option does not exist, so the last configuration runs with the default backoff.
- Reset: reads that find messages reset the wait to the polling frequency, and `pulling.backoff` is configurable. The ceiling stays at 1 s.
- After: the same, with the default ceiling lowered to 250 ms.

Measured on Linux 6.18 (WSL2), Node.js 24, sqlite3 driver. Values are p50 / p95 / max in ms.

| Configuration                                                   | Scenario       | Before            | Reset             | After           |
| --------------------------------------------------------------- | -------------- | ----------------- | ----------------- | --------------- |
| `batchSize: 100`, default backoff                               | steady trickle | 519 / 992 / 1046  | 50 / 90 / 92      | 51 / 89 / 92    |
| `batchSize: 100`, default backoff                               | after idle     | 627 / 1009 / 1009 | 640 / 1012 / 1012 | 188 / 197 / 197 |
| `batchSize: 1`, default backoff                                 | steady trickle | 33 / 184 / 215    | 31 / 176 / 208    | 28 / 44 / 45    |
| `batchSize: 1`, default backoff                                 | after idle     | 523 / 893 / 893   | 522 / 902 / 902   | 192 / 201 / 201 |
| `batchSize: 100`, `backoff.maxInMs: 20`, `batchDeadlineInMs: 0` | steady trickle | 495 / 966 / 1007  | 17 / 25 / 26      | 17 / 26 / 27    |
| `batchSize: 100`, `backoff.maxInMs: 20`, `batchDeadlineInMs: 0` | after idle     | 626 / 1004 / 1004 | 20 / 25 / 25      | 17 / 26 / 26    |

The ceiling bounds the wait after idle time and sets how often an idle consumer reads: once per ceiling. Ceilings measured at the default 50 ms polling frequency, `batchSize: 100`:

| `backoff`                       | Steady p50 | After idle p50 / max | Idle reads per second |
| ------------------------------- | ---------- | -------------------- | --------------------- |
| `maxInMs: 1000`                 | 83         | 557 / 937            | 1                     |
| `maxInMs: 500`                  | 83         | 384 / 518            | 2                     |
| `maxInMs: 250` (default)        | 84         | 242 / 247            | 4                     |
| `maxInMs: 250, multiplier: 1.5` | 85         | 295 / 303            | 4                     |
| `maxInMs: 100`                  | 83         | 118 / 153            | 10                    |
