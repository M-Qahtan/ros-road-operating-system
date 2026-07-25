export interface PostgresQueryResult<Row = unknown> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface PostgresClient {
  query<Row = unknown>(text: string, values?: readonly unknown[]): Promise<PostgresQueryResult<Row>>;
  release(): void;
}

export interface PostgresPool {
  connect(): Promise<PostgresClient>;
}
