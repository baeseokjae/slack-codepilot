import 'dotenv/config';
import { z } from 'zod';

const envSchema = z
  .object({
    SLACK_BOT_TOKEN: z.string().startsWith('xoxb-'),
    SLACK_SIGNING_SECRET: z.string().min(1),
    SLACK_APP_TOKEN: z.string().startsWith('xapp-').optional(),
    REDIS_URL: z.string().startsWith('redis://').default('redis://localhost:6379'),
    AI_PROVIDER: z.enum(['openai', 'vertex']).default('openai'),
    QWEN_API_KEY: z.string().min(1).optional(),
    QWEN_API_BASE_URL: z
      .string()
      .url()
      .default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
    QWEN_MODEL: z.string().default('qwen3-coder'),
    VERTEX_PROJECT_ID: z.string().min(1).optional(),
    VERTEX_LOCATION: z.string().default('us-central1'),
    VERTEX_MODEL: z.string().default('google/gemini-2.5-flash'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    PORT: z.coerce.number().default(4000),
    GITHUB_APP_ID: z.coerce.number().optional(),
    GITHUB_PRIVATE_KEY: z.string().optional(),
    GITHUB_INSTALLATION_ID: z.coerce.number().optional(),
    GIT_WORKSPACE_DIR: z.string().default('/tmp/codepilot-workspaces'),
    CODE_GEN_MAX_TOKENS: z.coerce.number().default(8192),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().default(30000),
  })
  .superRefine((data, ctx) => {
    if (data.AI_PROVIDER === 'openai' && !data.QWEN_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['QWEN_API_KEY'],
        message: 'QWEN_API_KEY is required when AI_PROVIDER is openai',
      });
    }
    if (data.AI_PROVIDER === 'vertex' && !data.VERTEX_PROJECT_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VERTEX_PROJECT_ID'],
        message: 'VERTEX_PROJECT_ID is required when AI_PROVIDER is vertex',
      });
    }
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
