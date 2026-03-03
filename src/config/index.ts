import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  SLACK_BOT_TOKEN: z.string().startsWith('xoxb-'),
  SLACK_SIGNING_SECRET: z.string().min(1),
  SLACK_APP_TOKEN: z.string().startsWith('xapp-').optional(),
  REDIS_URL: z.string().startsWith('redis://').default('redis://localhost:6379'),
  QWEN_API_KEY: z.string().min(1),
  QWEN_API_BASE_URL: z.string().url().default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
  QWEN_MODEL: z.string().default('qwen3-coder'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PORT: z.coerce.number().default(3000),
  GITHUB_APP_ID: z.coerce.number().optional(),
  GITHUB_PRIVATE_KEY: z.string().optional(),
  GITHUB_INSTALLATION_ID: z.coerce.number().optional(),
  GIT_WORKSPACE_DIR: z.string().default('/tmp/codepilot-workspaces'),
  CODE_GEN_MAX_TOKENS: z.coerce.number().default(8192),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().default(30000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  process.stderr.write(
    `Invalid environment variables: ${JSON.stringify(parsed.error.flatten().fieldErrors)}\n`,
  );
  process.exit(1);
}

export const config = parsed.data;
export type Config = z.infer<typeof envSchema>;
