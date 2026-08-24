import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import { LaunchpadError } from '@ssh-launchpad/shared'
import { controlErrorHandler, registerControlRoutes, type ControlRouteDependencies } from './control-routes.js'

export interface ControlAppDependencies extends ControlRouteDependencies { publicBaseUrl: string; webRoot?: string }

function hostAllowed(value: string | undefined, publicBaseUrl: string): boolean {
  if (!value) return false
  let expected: URL
  try { expected = new URL(publicBaseUrl) } catch { return false }
  const incoming = value.split(':')[0]?.toLowerCase()
  return incoming === expected.hostname.toLowerCase() || incoming === 'localhost' || incoming === '127.0.0.1' || incoming === '[::1]'
}

function originAllowed(value: string | undefined, publicBaseUrl: string): boolean {
  if (!value) return true
  try {
    const origin = new URL(value); const expected = new URL(publicBaseUrl)
    return origin.hostname === expected.hostname || origin.hostname === 'localhost' || origin.hostname === '127.0.0.1'
  } catch { return false }
}

export async function buildControlApp(dependencies: ControlAppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(cookie)
  app.addContentTypeParser(/^application\/(?:x-www-form-urlencoded|octet-stream)|^multipart\//, { parseAs: 'buffer' }, (_request, payload, done) => done(null, payload))
  app.addHook('onRequest', async (request: FastifyRequest) => {
    if (!hostAllowed(request.headers.host, dependencies.publicBaseUrl) || !originAllowed(request.headers.origin, dependencies.publicBaseUrl)) throw new LaunchpadError('FORBIDDEN', 'Request origin is not allowed')
    if (request.url.startsWith('/tunnel/')) return
    if (request.method === 'POST' && request.url === '/api/session') return
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    if (mutation && (!request.headers['content-type'] || !request.headers['content-type'].toLowerCase().startsWith('application/json'))) throw new LaunchpadError('VALIDATION_FAILED', 'Mutating requests must use application/json')
  })
  app.setErrorHandler(controlErrorHandler)
  await registerControlRoutes(app, dependencies)
  if (dependencies.webRoot) {
    await app.register(fastifyStatic, { root: dependencies.webRoot, prefix: '/', decorateReply: false })
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/') && !request.url.startsWith('/tunnel/') && request.headers.accept?.includes('text/html')) return reply.sendFile('index.html')
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    })
  }
  return app
}
