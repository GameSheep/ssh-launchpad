import type { Socket, Server } from 'node:net'
import type { SshSession } from '../ssh/ssh-session.js'
import { LaunchpadError } from '@ssh-launchpad/shared'
import { listenLocalPort } from './port-check.js'

export interface PortReservation {
  readonly appId: string
  readonly localPort: number
  activate(session: SshSession, remoteHost: string, remotePort: number): Promise<TunnelHandle>
  release(): Promise<void>
}

export interface TunnelHandle {
  readonly localPort: number
  close(): Promise<void>
}

export interface TunnelManager {
  reserve(appId: string, localPort: number): Promise<PortReservation>
  get(appId: string): TunnelHandle | undefined
  close(appId: string): Promise<void>
  closeAll(): Promise<void>
}

type ActiveForward = { socket: Socket; stream: NodeJS.ReadWriteStream }

class Reservation implements PortReservation {
  private target: { session: SshSession; host: string; port: number } | undefined
  private server: Server | undefined
  private readonly forwards = new Set<ActiveForward>()
  private handle: TunnelHandle | undefined
  private released = false

  constructor(
    readonly appId: string,
    readonly localPort: number,
    private readonly onReleased: () => void,
  ) {}

  async start(): Promise<void> {
    this.server = await listenLocalPort(this.localPort, (socket) => this.accept(socket))
  }

  async activate(session: SshSession, remoteHost: string, remotePort: number): Promise<TunnelHandle> {
    if (this.released) throw new LaunchpadError('TUNNEL_FAILED', 'Tunnel reservation has been released')
    if (this.target) throw new LaunchpadError('RESOURCE_BUSY', 'Tunnel is already active', { appId: this.appId })
    this.target = { session, host: remoteHost, port: remotePort }
    this.handle = { localPort: this.localPort, close: () => this.release() }
    return this.handle
  }

  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    this.target = undefined
    for (const forward of this.forwards) {
      forward.socket.destroy()
      ;(forward.stream as unknown as { destroy(): void }).destroy()
    }
    this.forwards.clear()
    await new Promise<void>((resolve) => {
      if (!this.server) { resolve(); return }
      this.server.close(() => resolve())
    })
    this.server = undefined
    this.onReleased()
  }

  private accept(socket: Socket): void {
    const target = this.target
    if (!target || this.released) { socket.destroy(); return }
    void target.session.openForward(target.host, target.port).then((stream) => {
      if (this.released) {
        ;(stream as unknown as { destroy(): void }).destroy()
        socket.destroy()
        return
      }
      const forward = { socket, stream }
      this.forwards.add(forward)
      const cleanup = () => {
        this.forwards.delete(forward)
        socket.destroy()
        ;(stream as unknown as { destroy(): void }).destroy()
      }
      socket.on('error', cleanup).on('close', cleanup)
      stream.on('error', cleanup).on('close', cleanup)
      socket.pipe(stream as unknown as NodeJS.WritableStream)
      ;(stream as unknown as NodeJS.ReadableStream).pipe(socket)
    }).catch(() => socket.destroy())
  }
}

export class DefaultTunnelManager implements TunnelManager {
  private readonly reservations = new Map<string, Reservation>()
  private readonly active = new Map<string, TunnelHandle>()

  async reserve(appId: string, localPort: number): Promise<PortReservation> {
    if (this.reservations.has(appId)) throw new LaunchpadError('RESOURCE_BUSY', 'Application already has a port reservation', { appId })
    const reservation = new Reservation(appId, localPort, () => {
      this.reservations.delete(appId)
      this.active.delete(appId)
    })
    await reservation.start()
    this.reservations.set(appId, reservation)
    const originalActivate = reservation.activate.bind(reservation)
    reservation.activate = async (...args) => {
      const handle = await originalActivate(...args)
      this.active.set(appId, handle)
      return handle
    }
    return reservation
  }

  get(appId: string): TunnelHandle | undefined {
    return this.active.get(appId)
  }

  async close(appId: string): Promise<void> {
    await this.reservations.get(appId)?.release()
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.reservations.values()].map((reservation) => reservation.release()))
  }
}
