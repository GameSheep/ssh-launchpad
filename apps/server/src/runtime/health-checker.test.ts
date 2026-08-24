import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { FetchHealthChecker } from './health-checker.js'

describe('FetchHealthChecker', () => {
  it('accepts reachable responses below 500', async () => {
    const server = createServer((_request, response) => { response.statusCode = 302; response.end() })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as { port: number }).port
    await expect(new FetchHealthChecker().check(`http://127.0.0.1:${port}/`, 1000)).resolves.toBeUndefined()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
})
