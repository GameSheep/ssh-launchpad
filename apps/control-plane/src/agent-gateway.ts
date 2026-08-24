import { LaunchpadError, parseAgentMessage, type AgentHelloMessage, type AgentMessage } from '@ssh-launchpad/shared'
import type WebSocket from 'ws'
import { AgentRegistry, type AgentSocket } from './agents/agent-registry.js'
import { PairingService } from './agents/pairing-service.js'

export class AgentGateway {
  constructor(private readonly registry: AgentRegistry, private readonly pairing: PairingService) {}

  handle(socket: WebSocket): void {
    let agentId: string | undefined
    const accept = (message: AgentMessage): void => {
      if (message.type === 'pair') {
        const paired = this.pairing.consume(message.code, message.name)
        agentId = paired.descriptor.id
        this.registry.attach(agentId, socket as unknown as AgentSocket)
        socket.send(JSON.stringify({ type: 'paired', agentId, token: paired.token }))
        return
      }
      if (message.type === 'hello') {
        const hello: AgentHelloMessage = message
        const descriptor = this.registry.authenticate(hello.agentId, hello.token)
        if (!descriptor) throw new LaunchpadError('PAIRING_INVALID', 'Agent credentials are invalid')
        agentId = descriptor.id
        this.registry.attach(agentId, socket as unknown as AgentSocket)
        socket.send(JSON.stringify({ type: 'paired', agentId, token: hello.token }))
        return
      }
      if (!agentId) throw new LaunchpadError('PAIRING_INVALID', 'Agent must complete pairing before sending messages')
      if (message.type === 'response' || message.type === 'event') this.registry.accept(agentId, message)
    }
    socket.on('message', (raw) => {
      try { accept(parseAgentMessage(JSON.parse(raw.toString()))) } catch (error) {
        const launchpad = error instanceof LaunchpadError ? error : new LaunchpadError('PAIRING_INVALID', 'Invalid Agent handshake')
        try { socket.send(JSON.stringify({ type: 'error', error: { code: launchpad.code, message: launchpad.message } })) } catch { /* socket already closed */ }
        socket.close()
      }
    })
    socket.on('close', () => { if (agentId) this.registry.detach(agentId, socket as unknown as AgentSocket) })
    socket.on('error', () => { if (agentId) this.registry.detach(agentId, socket as unknown as AgentSocket) })
  }
}
