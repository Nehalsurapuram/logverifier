/**
 * Turning driver errors into something safe to log.
 *
 * PostgreSQL error objects are not safe to log wholesale. The `detail` field in
 * particular quotes the offending values back at you:
 *
 *   detail: 'Key (email)=(ada@example.com) already exists.'
 *
 * Log that and every duplicate registration writes a customer's email address
 * into your log aggregator. `where` and `internalQuery` leak the same way. So
 * this module works by allowlist: named fields are copied across, everything
 * else is dropped, and what survives is passed through a redactor.
 */

/** SQLSTATE codes this codebase reacts to by name rather than number. */
export const PG_ERRORS = Object.freeze({
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
  UNDEFINED_TABLE: '42P01',
  UNDEFINED_COLUMN: '42703',
  SYNTAX_ERROR: '42601',
  INSUFFICIENT_PRIVILEGE: '42501',
  QUERY_CANCELED: '57014',
  LOCK_NOT_AVAILABLE: '55P03',
  DEADLOCK_DETECTED: '40P01',
  SERIALIZATION_FAILURE: '40001',
  TOO_MANY_CONNECTIONS: '53300',
});

const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '53300', // too_many_connections
]);

/**
 * node-postgres reports pool-level failures as plain Errors with no `code` at
 * all, so the message is the only signal available. These are the exact strings
 * it produces.
 */
const CONNECTION_MESSAGES =
  /timeout exceeded when trying to connect|connection terminated|connection refused|could not connect|client has encountered a connection error|server closed the connection/i;

/** Credentials that must never survive into a log line or a response. */
const REDACTIONS = [
  // postgresql://user:secret@host  →  postgresql://***:***@host
  [/\b(postgres(?:ql)?:\/\/)[^:@\s/]+:[^@\s]*@/gi, '$1***:***@'],
  // password=secret, PGPASSWORD: 'secret', pwd="secret"
  [/\b(password|pgpassword|pwd)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;)]+)/gi, '$1$2***'],
];

export function redactSecrets(text) {
  if (typeof text !== 'string') return text;
  return REDACTIONS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

/**
 * Collapses a statement to a single loggable line.
 *
 * The SQL text is safe to log precisely because every value is a bound
 * parameter — that is the security dividend of never interpolating input. The
 * parameters themselves are never logged.
 */
export function summariseStatement(sql, maxLength = 200) {
  const collapsed = String(sql).replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength)}…` : collapsed;
}

export function classifyDatabaseError(err) {
  if (err == null) return 'unknown';
  if (CONNECTION_CODES.has(err.code) || CONNECTION_MESSAGES.test(err.message ?? '')) return 'connection';
  if (err.code === PG_ERRORS.QUERY_CANCELED || /query_timeout|statement timeout/i.test(err.message ?? '')) {
    return 'timeout';
  }
  if (typeof err.code === 'string' && err.code.startsWith('23')) return 'constraint';
  if (typeof err.code === 'string' && (err.code.startsWith('42') || err.code.startsWith('40'))) return 'query';
  return 'unknown';
}

export function isConnectionError(err) {
  return classifyDatabaseError(err) === 'connection';
}

export function isUniqueViolation(err, constraint) {
  if (err?.code !== PG_ERRORS.UNIQUE_VIOLATION) return false;
  return constraint ? err.constraint === constraint : true;
}

/**
 * A driver error rewritten to carry only fields that are safe to record.
 *
 * `code` and `constraint` are preserved verbatim so existing call sites can
 * still branch on them; the value-bearing fields are gone for good.
 */
export class DatabaseError extends Error {
  constructor(cause, { statement } = {}) {
    super(redactSecrets(cause?.message ?? 'Database error'), { cause });

    this.name = 'DatabaseError';
    this.kind = classifyDatabaseError(cause);

    // Structural identifiers: which rule was broken, and where. None of these
    // contain a value a user supplied.
    this.code = cause?.code;
    this.constraint = cause?.constraint;
    this.table = cause?.table;
    this.column = cause?.column;
    this.schema = cause?.schema;
    this.routine = cause?.routine;
    this.severity = cause?.severity;

    if (statement) this.statement = summariseStatement(statement);

    // Deliberately NOT copied: detail, where, internalQuery, hint. Each can
    // quote the offending value back, and hint sometimes echoes input too.
  }

  /** Exactly the fields that may go into a log line. */
  toLogContext() {
    return {
      kind: this.kind,
      sqlstate: this.code,
      constraint: this.constraint,
      table: this.table,
      column: this.column,
      routine: this.routine,
      statement: this.statement,
      message: this.message,
    };
  }
}

/** Wraps a driver error unless it is already wrapped. */
export function wrapDatabaseError(err, statement) {
  if (err instanceof DatabaseError) return err;
  return new DatabaseError(err, { statement });
}
