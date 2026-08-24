import { z } from 'zod'

const portSchema = z.coerce.number().int().min(1).max(65535)
const nonEmpty = z.string().trim().min(1)

export const serverInputSchema = z.object({
  name: nonEmpty,
  source: z.enum(['manual', 'ssh-config']),
  configAlias: z.string().trim().optional(),
  host: nonEmpty,
  port: portSchema.default(22),
  username: nonEmpty,
  authType: z.enum(['password', 'private-key', 'ssh-config']),
  privateKeyPath: z.string().trim().optional(),
  notes: z.string().default(''),
})

export const remoteAppInputSchema = z.object({
  serverId: nonEmpty,
  name: nonEmpty,
  type: z.enum(['dsh', 'openclaw', 'custom']),
  remoteHost: nonEmpty,
  remotePort: portSchema,
  localPort: portSchema,
  protocol: z.enum(['http', 'https']),
  healthPath: z.string().startsWith('/'),
  autoStart: z.boolean(),
  workingDirectory: z.string().trim().optional(),
  startCommand: z.string().trim().optional(),
  stopOnDisconnect: z.boolean(),
  stopCommand: z.string().trim().optional(),
  iconKind: z.enum(['preset', 'url', 'upload', 'letter']),
  iconValue: nonEmpty,
  startTimeoutMs: z.coerce.number().int().min(1000).max(300000).default(30000),
  healthTimeoutMs: z.coerce.number().int().min(1000).max(120000).default(10000),
}).superRefine((value, context) => {
  if (value.autoStart && !value.startCommand) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['startCommand'], message: 'startCommand is required when autoStart is enabled' })
  }
  if (value.stopOnDisconnect && !value.stopCommand) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['stopCommand'], message: 'stopCommand is required when stopOnDisconnect is enabled' })
  }
})

export type ServerInputParse = z.infer<typeof serverInputSchema>
export type RemoteAppInputParse = z.infer<typeof remoteAppInputSchema>
