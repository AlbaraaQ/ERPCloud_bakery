import { z } from 'zod';
const Env = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 chars'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
});
export type Env = z.infer<typeof Env>;
export function loadEnv(): Env {
  const r = Env.safeParse(process.env);
  if (!r.success) throw new Error('Invalid environment: ' + r.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}
