import { createLogger, LogLevel } from '@enterprise/common'

const logger = createLogger('frontend', LogLevel.INFO)

export { LogLevel }

export function logInfo(msg: string, meta?: any) {
  logger.info(msg, meta)
}

export function logError(msg: string, meta?: any) {
  logger.error(msg, meta)
}

export function logAction(action: string, result: 'success' | 'error' | 'pending', meta?: any) {
  logger.logAction(action, result, meta)
}
