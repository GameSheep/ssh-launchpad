import type { RemoteAppRecord } from '@ssh-launchpad/shared'
import { LaunchpadError } from '@ssh-launchpad/shared'

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const hopByHop = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length'])

export interface ProxyRequest {
  app: RemoteAppRecord
  method: string
  path: string
  headers: Record<string, string>
  bodyBase64?: string
}

export interface ProxyResponse {
  status: number
  headers: Record<string, string>
  bodyBase64: string
}

export async function proxyLocalApp(request: ProxyRequest): Promise<ProxyResponse> {
  if (!request.path.startsWith('/') || request.path.startsWith('//') || request.path.includes('://')) throw new LaunchpadError('VALIDATION_FAILED', 'Relay path must be relative to the application')
  const protocol = request.app.protocol === 'https' ? 'https' : 'http'
  const url = `${protocol}://127.0.0.1:${request.app.localPort}${request.path}`
  const headers = Object.fromEntries(Object.entries(request.headers).filter(([key]) => !hopByHop.has(key.toLowerCase())))
  const body = request.bodyBase64 ? Buffer.from(request.bodyBase64, 'base64') : undefined
  let response: Response
  try {
    const init: RequestInit = { method: request.method, headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) }
    if (body) init.body = body as unknown as BodyInit
    response = await fetch(url, init)
  } catch {
    throw new LaunchpadError('REMOTE_PORT_CLOSED', 'The Agent could not reach the local application')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new LaunchpadError('TUNNEL_FAILED', 'Relay response is larger than 10 MiB')
  const safeHeaders: Record<string, string> = {}
  for (const key of ['content-type', 'cache-control', 'etag', 'last-modified', 'location']) {
    const value = response.headers.get(key)
    if (value) safeHeaders[key] = value
  }
  return { status: response.status, headers: safeHeaders, bodyBase64: Buffer.from(bytes).toString('base64') }
}
