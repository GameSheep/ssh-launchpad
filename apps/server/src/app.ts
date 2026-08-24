import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import { LaunchpadError, type ApiErrorBody } from '@ssh-launchpad/shared'
import { registerSecurity } from './api/security.js'
import { registerRoutes, type ApiRouteDependencies } from './api/routes.js'
import { registerEventsRoute } from './api/events-route.js'
import type { RuntimeEventBus } from './runtime/types.js'

export interface AppDependencies extends ApiRouteDependencies {
  events: RuntimeEventBus
  sessionToken: string
  allowedPort: number
  webRoot?: string
}

function statusFor(error: LaunchpadError): number {
  if (error.code === 'FORBIDDEN') return 403
  if (error.code === 'NOT_FOUND') return 404
  if (error.code === 'RESOURCE_BUSY' || error.code === 'LOCAL_PORT_IN_USE') return 409
  if (error.code === 'INTERNAL_ERROR') return 500
  return 400
}

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(cookie)
  ;(app as FastifyInstance & { sessionToken?: string }).sessionToken = dependencies.sessionToken
  registerSecurity(app, { sessionToken: dependencies.sessionToken, allowedPort: dependencies.allowedPort })
  app.setErrorHandler((error, _request, reply) => {
    const launchpadError = error instanceof LaunchpadError ? error : new LaunchpadError('INTERNAL_ERROR', 'Internal server error')
    const body: ApiErrorBody = { error: { code: launchpadError.code, message: launchpadError.message } }
    if (launchpadError.details) body.error.details = launchpadError.details
    reply.code(statusFor(launchpadError)).send(body)
  })
  await registerRoutes(app, dependencies)
  await registerEventsRoute(app, dependencies.events)
  if (dependencies.webRoot) await app.register(fastifyStatic, { root: dependencies.webRoot, prefix: '/' })
  return app
}
