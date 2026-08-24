import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { LaunchpadError } from '@ssh-launchpad/shared'

export interface SecurityOptions {
  sessionToken: string
  allowedPort: number
}

function allowedHost(value: string | undefined, port: number): boolean {
  if (!value) return false
  try {
    const url = new URL(`http://${value}`)
    return (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && Number(url.port || 80) === port
  } catch { return false }
}

function sameOrigin(value: string | undefined, port: number): boolean {
  if (!value) return true
  try {
    const url = new URL(value)
    return (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && Number(url.port || 80) === port
  } catch { return false }
}

export function registerSecurity(app: FastifyInstance, options: SecurityOptions): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!allowedHost(request.headers.host, options.allowedPort) || !sameOrigin(request.headers.origin, options.allowedPort)) {
      throw new LaunchpadError('FORBIDDEN', 'Request origin is not allowed')
    }
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    if (!mutation) return
    if (request.headers['content-type'] && !request.headers['content-type'].toLowerCase().startsWith('application/json')) {
      throw new LaunchpadError('VALIDATION_FAILED', 'Mutating requests must use application/json')
    }
    if (request.cookies.launchpad_session !== options.sessionToken) {
      throw new LaunchpadError('FORBIDDEN', 'A valid launchpad session is required')
    }
    void reply
  })
}
