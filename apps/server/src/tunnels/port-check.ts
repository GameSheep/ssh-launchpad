import { createServer, type Server } from 'node:net'
import { LaunchpadError } from '@ssh-launchpad/shared'

export function listenLocalPort(port: number, onConnection: (socket: import('node:net').Socket) => void): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(onConnection)
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      reject(error.code === 'EADDRINUSE'
        ? new LaunchpadError('LOCAL_PORT_IN_USE', `Local port ${port} is already in use`, { localPort: port })
        : new LaunchpadError('TUNNEL_FAILED', 'Unable to bind the local tunnel port'))
    }
    const onListening = () => { server.off('error', onError); resolve(server) }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}
