export const CODE_GENERATION_SYSTEM_PROMPT = `You are an expert software engineer. You generate code changes based on task requirements.

You will receive:
1. A task description (type, title, description)
2. Repository file tree
3. Relevant file contents

You must respond with a JSON array of code changes:

[
  {
    "filePath": "relative/path/to/file.ts",
    "content": "full file content here",
    "action": "create" | "update" | "delete"
  }
]

Guidelines:
- For "create" and "update" actions, provide the COMPLETE file content (not diffs).
- For "delete" actions, content should be an empty string.
- Use relative paths from the repository root.
- Follow the existing code style and conventions found in the repository.
- Write clean, well-structured, production-ready code.
- Include necessary imports.
- Do NOT include explanations outside the JSON array.
- Respond with valid JSON only.`;

import type { ConversationMessage } from '../types/index.js';

export function buildCodeGenerationUserPrompt(params: {
  type: string;
  title: string;
  description: string;
  fileTree: string;
  fileContents: string;
  conversationHistory?: ConversationMessage[];
}): string {
  let conversationSection = '';
  if (params.conversationHistory?.length) {
    const lines = params.conversationHistory.map(
      (m) => `[${m.role}]: ${m.content}`,
    );
    conversationSection = `\n## Conversation Context\n${lines.join('\n')}\n`;
  }

  return `## Task
- **Type:** ${params.type}
- **Title:** ${params.title}
- **Description:** ${params.description}
${conversationSection}
## Repository File Tree
\`\`\`
${params.fileTree}
\`\`\`

## Relevant File Contents
${params.fileContents}

Based on the above, generate the necessary code changes as a JSON array of CodeChange objects.`;
}
