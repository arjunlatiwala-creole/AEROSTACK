// Aerostack V1 Logger Utility
// Standardized logging for all Aerostack components

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  component: string;
  action?: string;
  user_id?: string;
  loop_id?: string;
  person_id?: string;
  payload_shape?: string;
  result?: 'success' | 'error' | 'pending';
  latency_ms?: number;
  error_code?: string;
  metadata?: Record<string, any>;
}

class Logger {
  private level: LogLevel = LogLevel.INFO;
  private component: string = 'aerostack';

  constructor(component: string, level: LogLevel = LogLevel.INFO) {
    this.component = component;
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  private formatEntry(entry: LogEntry): string {
    const { timestamp, level, message, component, ...metadata } = entry;
    const levelStr = LogLevel[level];
    const metaStr = Object.keys(metadata).length > 0 ? 
      JSON.stringify(metadata) : '';
    
    return `[${timestamp}] ${levelStr} [${component}] ${message} ${metaStr}`.trim();
  }

  private log(level: LogLevel, message: string, metadata: Partial<LogEntry> = {}): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      component: this.component,
      ...metadata,
    };

    const formatted = this.formatEntry(entry);
    
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(formatted);
        break;
      case LogLevel.INFO:
        console.info(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      case LogLevel.ERROR:
        console.error(formatted);
        break;
    }
  }

  debug(message: string, metadata?: Partial<LogEntry>): void {
    this.log(LogLevel.DEBUG, message, metadata);
  }

  info(message: string, metadata?: Partial<LogEntry>): void {
    this.log(LogLevel.INFO, message, metadata);
  }

  warn(message: string, metadata?: Partial<LogEntry>): void {
    this.log(LogLevel.WARN, message, metadata);
  }

  error(message: string, metadata?: Partial<LogEntry>): void {
    this.log(LogLevel.ERROR, message, metadata);
  }

  // Convenience methods for common Aerostack operations
  logAction(action: string, result: 'success' | 'error' | 'pending', metadata: Partial<LogEntry> = {}): void {
    this.info(`Action: ${action}`, { action, result, ...metadata });
  }

  logApiCall(endpoint: string, method: string, latency_ms: number, result: 'success' | 'error', metadata: Partial<LogEntry> = {}): void {
    const message = `API ${method} ${endpoint} - ${result} (${latency_ms}ms)`;
    const level = result === 'error' ? LogLevel.ERROR : LogLevel.INFO;
    this.log(level, message, { action: `api_${method.toLowerCase()}`, latency_ms, result, ...metadata });
  }

  logSlackCommand(command: string, user_id: string, result: 'success' | 'error', metadata: Partial<LogEntry> = {}): void {
    this.info(`Slack command: ${command}`, { action: 'slack_command', user_id, result, ...metadata });
  }

  logJiraWebhook(event: string, issue_key: string, result: 'success' | 'error', metadata: Partial<LogEntry> = {}): void {
    this.info(`Jira webhook: ${event} for ${issue_key}`, { action: 'jira_webhook', result, ...metadata });
  }
}

// Create default loggers for each component
export const createLogger = (component: string, level: LogLevel = LogLevel.INFO): Logger => {
  return new Logger(component, level);
};

// Pre-configured loggers
export const apiLogger = createLogger('api');
export const frontendLogger = createLogger('frontend');
export const slackLogger = createLogger('slack');
export const jiraLogger = createLogger('jira');
export const dbLogger = createLogger('database');

// Default export
export default Logger;
