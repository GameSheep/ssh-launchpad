export interface DetachedCommandInput {
  appId: string
  workingDirectory?: string
  command: string
}

export interface DetachedProcessCommand {
  command: string
  logPath: string
}

export function quotePosix(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

export function buildDetachedCommand(input: DetachedCommandInput): DetachedProcessCommand {
  const logPath = `$HOME/.cache/ssh-launchpad/${input.appId}.log`
  const cwd = input.workingDirectory ? `cd ${quotePosix(input.workingDirectory)} && ` : ''
  const command = [
    'mkdir -p "$HOME/.cache/ssh-launchpad"',
    cwd,
    `nohup sh -lc ${quotePosix(input.command)}`,
    `>> "$HOME/.cache/ssh-launchpad/${quotePosix(input.appId).slice(1, -1)}.log" 2>&1 </dev/null & echo $!`,
  ].join(' ')
  return { command, logPath }
}
