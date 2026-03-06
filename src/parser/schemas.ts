import { z } from 'zod';

export const parsedRequestSchema = z.object({
  type: z.enum(['feature', 'fix', 'refactor', 'docs', 'test']),
  title: z.string().min(1),
  description: z.string().min(1),
  targetRepo: z.string().nullable(),
  priority: z.enum(['low', 'medium', 'high']),
  missingInfo: z.array(z.string()).nullable(),
  acceptanceCriteria: z.array(z.string()).nullable().optional(),
});

export type ParsedRequestSchema = z.infer<typeof parsedRequestSchema>;
