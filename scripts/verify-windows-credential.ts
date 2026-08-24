import { randomUUID } from 'node:crypto'
import { AsyncEntry } from '@napi-rs/keyring'

const service = 'ssh-launchpad'
const account = `verification:${randomUUID()}`
const secret = `launchpad-check-${randomUUID()}`
const entry = new AsyncEntry(service, account)

try {
  await entry.setPassword(secret)
  const value = await entry.getPassword()
  if (value !== secret) throw new Error('Credential Manager returned an unexpected value')
  await entry.deletePassword()
  console.log('Windows Credential Manager verification passed')
} catch {
  await entry.deletePassword().catch(() => undefined)
  console.error('Windows Credential Manager verification failed')
  process.exitCode = 1
}
