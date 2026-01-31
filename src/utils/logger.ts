import pino from 'pino';
import { getConfig } from '../config';

/**
 * Create a logger instance
 */
function createLogger() {
  const config = getConfig();
  
  return pino({
    level: config.logLevel,
    base: {
      pid: process.pid,
    },
  });
}

// Singleton logger instance
let loggerInstance: pino.Logger | null = null;

/**
 * Get the logger singleton
 */
export function getLogger(): pino.Logger {
  if (!loggerInstance) {
    loggerInstance = createLogger();
  }
  return loggerInstance;
}

/**
 * Create a child logger with additional context
 */
export function getChildLogger(context: Record<string, unknown>): pino.Logger {
  return getLogger().child(context);
}

/**
 * Reset the logger singleton
 * Useful for testing
 */
export function resetLogger(): void {
  loggerInstance = null;
}

// Export default logger
export default getLogger();
