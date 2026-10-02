// A unique constraint violation (duplicate slug, storage_key, or token_hash)
// is not wrapped: it surfaces as bun:sqlite's own `SQLiteError` with
// `code: 'SQLITE_CONSTRAINT_UNIQUE'`, which is already a distinguishable,
// well shaped error. Only "no such row" needs a type of its own.
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
