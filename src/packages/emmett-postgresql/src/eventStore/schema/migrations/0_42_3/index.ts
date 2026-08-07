import {
  rawSql,
  sqlMigration,
  type SQLMigration,
} from '@event-driven-io/dumbo';
import { messagesTable } from '../../typing';

// emt_messages carries no index beyond its primary key, so the consumer poll scans and
// sorts the whole partition on every tick, including the caught-up poll that returns
// nothing.
//
// Two indexes, because this version's poll filters on global_position directly
// (AND global_position >= cursor) while ordering by transaction_id, global_position:
//   - (global_position) serves the caught-up and slightly-behind polls, where the only
//     selective term is the cursor; transaction_id < xmin matches nearly every row.
//   - (transaction_id, global_position) matches the ORDER BY, so a backlogged consumer
//     can stop the scan at the LIMIT instead of sorting everything past the cursor.
// Neither covers both cases, so the planner is left to choose per cursor position.
//
// 0.43.0 rewrites the cursor as a row comparison on (transaction_id, global_position),
// which makes the composite sufficient and (global_position) unreachable; the 0.43.0
// migration drops it.
//
// partition/is_archived are omitted deliberately: emt_messages is partitioned by both,
// so they are constant within every leaf these indexes are created on.
//
// Takes a ShareLock on the parent and every leaf, blocking writes while they build.
// CREATE INDEX CONCURRENTLY cannot replace this: PostgreSQL rejects it on a partitioned
// table, and it cannot run inside the migration transaction.
const migration_0_42_3_addMessagesPollIndexesSQL = rawSql(`
CREATE INDEX IF NOT EXISTS idx_messages_global_position
ON ${messagesTable.name}(global_position);

CREATE INDEX IF NOT EXISTS idx_messages_transaction_id_global_position
ON ${messagesTable.name}(transaction_id, global_position);
`);

export const migration_0_42_3_addMessagesPollIndexes: SQLMigration =
  sqlMigration('emt:postgresql:eventstore:0.42.3:add-messages-poll-indexes', [
    migration_0_42_3_addMessagesPollIndexesSQL,
  ]);
