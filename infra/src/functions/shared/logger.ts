import { Context } from "aws-lambda";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogMeta {
  [key: string]: any;
}

export class Logger {
  private contextName?: string;
  private lambdaContext?: Context;

  constructor(contextName?: string, lambdaContext?: Context) {
    this.contextName = contextName;
    this.lambdaContext = lambdaContext;
  }

  private formatMessage(level: LogLevel, message: string, meta?: LogMeta) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.contextName || "global",
      requestId: this.lambdaContext?.awsRequestId,
      message,
      ...(meta || {}),
    };
    return JSON.stringify(logEntry);
  }

  debug(message: string, meta?: LogMeta) {
    console.debug(this.formatMessage("debug", message, meta));
  }

  info(message: string, meta?: LogMeta) {
    console.info(this.formatMessage("info", message, meta));
  }

  warn(message: string, meta?: LogMeta) {
    console.warn(this.formatMessage("warn", message, meta));
  }

  error(message: string, meta?: LogMeta) {
    console.error(this.formatMessage("error", message, meta));
  }
}

export const createLogger = (contextName?: string, lambdaContext?: Context) =>
  new Logger(contextName, lambdaContext);

export type { LogLevel, LogMeta };
