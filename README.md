# Slack CodePilot

Slack CodePilot is an AI-powered Slack agent that automates feature development and bug fixing. By simply mentioning the bot in Slack with a request, it parses your intent, creates a GitHub issue, generates the necessary code changes, and opens a Pull Request—all while keeping you updated in the Slack thread.

## 🚀 Features

- **AI Request Parsing**: Understands natural language requests (features, bug fixes, refactoring, docs, tests) and extracts necessary context.
- **Automated Workflow**:
  1. Creates a GitHub Issue.
  2. Clones the target repository.
  3. Generates code changes using AI (powered by Qwen/OpenAI-compatible APIs).
  4. Validates, applies, and pushes the code to a new branch.
  5. Opens a Pull Request.
- **Real-time Slack Updates**: Provides step-by-step progress, success, and failure notifications in the Slack thread using Block Kit.
- **Interactive UI**: Allows users to cancel running jobs directly from Slack.
- **Resilience & Security**:
  - Built-in Circuit Breaker and Rate Limiter for external API calls.
  - Code Validator to prevent dangerous code execution (e.g., `eval`, `rm -rf /`).
  - Error Sanitizer to mask sensitive tokens in logs and messages.
- **Observability**: Exposes Prometheus metrics and uses structured logging (Pino).

## 🏗 Architecture

The project is divided into two main components:
1. **Slack Bot (`src/server.ts`)**: Listens to Slack events, parses user requests, and enqueues jobs.
2. **Worker (`src/worker.ts`)**: Processes jobs from the queue (BullMQ) and executes the pipeline steps.

## 📋 Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.15.4
- Redis
- Slack App (with Socket Mode enabled)
- GitHub App (for repository access)
- Qwen API Key (or any OpenAI-compatible API key)

## ⚙️ Environment Variables

Create a `.env` file in the root directory:

env
# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token # Required for Socket Mode

# Redis Configuration
REDIS_URL=redis://localhost:6379

# AI Configuration (Qwen by default)
QWEN_API_KEY=your-api-key
QWEN_API_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3-coder
CODE_GEN_MAX_TOKENS=8192

# GitHub Configuration
GITHUB_APP_ID=your-github-app-id
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_INSTALLATION_ID=your-installation-id

# Application Configuration
LOG_LEVEL=info
PORT=3000
GIT_WORKSPACE_DIR=/tmp/codepilot-workspaces
SHUTDOWN_TIMEOUT_MS=30000


## 🛠 Installation & Running Locally

1. Install dependencies:
   bash
   pnpm install
   

2. Start Redis (if not running):
   bash
   docker run -p 6379:6379 -d redis:7-alpine
   

3. Run the Slack Bot (Development):
   bash
   pnpm dev
   

4. Run the Worker (Development):
   bash
   pnpm dev:worker
   

## 🐳 Running with Docker Compose

The project includes a `docker-compose.yml` for easy deployment. It sets up the bot, worker, redis, and a Cloudflare tunnel.

bash
docker-compose up -d


## 🧪 Development

- **Linting**: `pnpm lint`
- **Formatting**: `pnpm format`
- **Testing**: `pnpm test`
- **Build**: `pnpm build`

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
