import { LaunchpadError } from '@ssh-launchpad/shared'
import type { HealthChecker } from './types.js'

export class FetchHealthChecker implements HealthChecker {
  async check(url: string, timeoutMs: number): Promise<void> {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (response.status >= 500) throw new Error(`HTTP ${response.status}`)
    } catch {
      throw new LaunchpadError('HEALTH_CHECK_FAILED', 'Application health check failed')
    }
  }
}

export { FetchHealthChecker as HealthCheckerImpl }
