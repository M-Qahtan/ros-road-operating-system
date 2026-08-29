import {
  ContactSqlConnectionPort,
  ContactSqlPoolPort,
  ContactSqlQueryResult,
  ContactSqlRow
} from '../../ros-eye/contact-orchestration-postgres.js';
import { PostgresClient, PostgresPool } from './postgres-types.js';

class ClientConnection implements ContactSqlConnectionPort {
  constructor(private readonly client: PostgresClient) {}

  async query<Row extends ContactSqlRow = ContactSqlRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<ContactSqlQueryResult<Row>> {
    const result = await this.client.query<Row>(text, values);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  }
}

/**
 * Adapts the core PostgreSQL pool to the explicit transaction contract used by
 * the durable ROS Eye contact runtime. A transaction never spans an external
 * network call and every acquired client is released exactly once.
 */
export class PostgresTransactionPool implements ContactSqlPoolPort {
  constructor(private readonly pool: PostgresPool) {}

  async query<Row extends ContactSqlRow = ContactSqlRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<ContactSqlQueryResult<Row>> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<Row>(text, values);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    } finally {
      client.release();
    }
  }

  async transaction<T>(work: (connection: ContactSqlConnectionPort) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(new ClientConnection(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      throw error;
    } finally {
      client.release();
    }
  }
}
