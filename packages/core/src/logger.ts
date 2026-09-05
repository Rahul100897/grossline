// Minimal structured logger. One place to swap for pino later; also the seam
// the credential tests spy on to prove plaintext never reaches a log call.
type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, message: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => emit('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => emit('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit('error', message, fields),
};
