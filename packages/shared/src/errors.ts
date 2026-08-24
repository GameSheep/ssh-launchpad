export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'LOCAL_PORT_IN_USE'
  | 'SSH_AUTH_FAILED'
  | 'SSH_HOST_KEY_UNKNOWN'
  | 'SSH_HOST_KEY_CHANGED'
  | 'SSH_CONNECTION_FAILED'
  | 'REMOTE_PORT_CLOSED'
  | 'REMOTE_START_FAILED'
  | 'REMOTE_START_TIMEOUT'
  | 'TUNNEL_FAILED'
  | 'HEALTH_CHECK_FAILED'
  | 'CREDENTIAL_UNAVAILABLE'
  | 'RESOURCE_BUSY'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INTERNAL_ERROR'

export class LaunchpadError extends Error {
  readonly code: ErrorCode
  readonly details: Record<string, unknown> | undefined

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'LaunchpadError'
    this.code = code
    this.details = details
  }
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode
    message: string
    details?: Record<string, unknown>
  }
}
