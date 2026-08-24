import { describe, expect, it } from 'vitest'
import { buildDetachedCommand, quotePosix } from './posix-command.js'

describe('POSIX command helpers', () => {
  it('quotes embedded single quotes safely', () => {
    expect(quotePosix("a'b")).toBe("'a'\"'\"'b'")
  })

  it('builds a detached nohup wrapper with a stable log path', () => {
    const result = buildDetachedCommand({ appId: 'app-1', workingDirectory: "/srv/it's app", command: "echo 'hello'" })
    expect(result.command).toContain('nohup sh -lc')
    expect(result.command).toContain('</dev/null')
    expect(result.command).toContain('echo $!')
    expect(result.logPath).toBe('$HOME/.cache/ssh-launchpad/app-1.log')
    expect(result.command).toContain("/srv/it'\"'\"'s app")
  })
})
