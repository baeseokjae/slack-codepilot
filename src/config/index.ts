import 'dotenv/config';
import { z } from 'zod';

const envSchema = z
  .object({
    SLACK_BOT_TOKEN: z.string().startsWith('xoxb-'),
    SLACK_SIGNING_SECRET: z.string().min(1),
    SLACK_APP_TOKEN: z.string().startsWith('xapp-').optional(),
    REDIS_URL: z.string().startsWith('redis://').default('redis://localhost:6379'),
    AI_PROVIDER: z.enum(['openai', 'vertex']).default('openai'),
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENAI_BASE_URL: z
      .string()
      .url()
      .default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
    OPENAI_MODEL: z.string().default('qwen3-coder'),
    VERTEX_PROJECT_ID: z.string().min(1).optional(),
    VERTEX_LOCATION: z.string().default('us-central1'),
    VERTEX_MODEL: z.string().default('google/gemini-2.5-flash'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    PORT: z.coerce.number().default(4000),
    GITHUB_APP_ID: z.coerce.number().optional(),
    GITHUB_PRIVATE_KEY: z.string().optional(),
    GITHUB_INSTALLATION_ID: z.coerce.number().optional(),
    GITHUB_DEFAULT_ORG: z.string().min(1).optional(),
    GITHUB_REVIEW_TEAM: z.string().min(1).optional(),
    SLACK_GITHUB_USER_MAP: z.string().optional(),
    NOTION_API_KEY: z.string().optional(),
    NOTION_ISSUE_DATABASE_ID: z.string().optional(),
    GIT_WORKSPACE_DIR: z.string().default('/tmp/codepilot-workspaces'),
    CODE_GEN_MAX_TOKENS: z.coerce.number().default(16384),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().default(30000),
    THREAD_TTL_SECONDS: z.coerce.number().default(3600),
    PENDING_TTL_SECONDS: z.coerce.number().default(1800),
  })
  .superRefine((data, ctx) => {
    if (data.AI_PROVIDER === 'openai' && !data.OPENAI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OPENAI_API_KEY'],
        message: 'OPENAI_API_KEY is required when AI_PROVIDER is openai',
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
