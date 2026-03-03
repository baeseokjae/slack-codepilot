# Slack CodePilot

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.7.3-blue.svg)

Slack CodePilot is an AI-powered Slack agent bot that automates feature development and bug fixing directly from your Slack workspace. By simply describing a task in Slack, CodePilot will understand the request, create a GitHub issue, clone the repository, generate the necessary code changes, push them to a new branch, and open a Pull Request.

## ✨ Features

- **Conversational Interface**: Interact with the bot naturally via Slack mentions and threads.
- **Automated Workflow**:
  1. Parses the request to understand the intent (feature, bug fix, refactor, etc.).
  2. Creates a GitHub Issue tracking the request.
  3. Clones the target repository.
  4. Generates code changes using an advanced LLM (default: Qwen3-Coder).
  5. Validates code for security (prevents dangerous commands like `rm -rf /`, `eval()`, etc.).
  6. Commits and pushes changes to a new branch.
  7. Opens a GitHub Pull Request automatically.
- **Real-time Feedback**: Provides progress updates in Slack using rich Block Kit UI.
- **Resilience & Security**: Built-in Circuit Breaker, Rate Limiter, Error Sanitizer (redacts sensitive tokens), and Code Validator.
- **Observability**: Exposes Prometheus metrics and provides structured JSON logging (Pino).
- **Scalable Architecture**: Separated Bot Server and Worker processes using BullMQ and Redis.

## 🏗 Architecture

The project is divided into two main components:
1. **Slack Bot Server (`src/server.ts`)**: Listens to Slack events, parses natural language requests using AI, and enqueues tasks.
2. **Worker (`src/worker.ts`)**: Consumes tasks from the queue and executes the 5-step pipeline (Issue -> Clone -> Code Gen -> Push -> PR).

## 📋 Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.15.4
- Redis (for BullMQ)
- Slack App (with Bot Token, App Token, and Signing Secret)
- GitHub App or Personal Access Token
- AI API Key (OpenAI-compatible, default configured for Aliyun DashScope / Qwen)

## 🚀 Installation & Setup

### 1. Clone the repository

bash
git clone https://github.com/yourusername/slack-codepilot.git
cd slack-codepilot


### 2. Install dependencies

bash
corepack enable
pnpm install


### 3. Environment Variables

Create a `.env` file in the root directory based on the configuration schema:

env
# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token # Required for Socket Mode

# Redis Configuration
REDIS_URL=redis://localhost:6379

# AI Configuration (Default: Qwen via DashScope)
QWEN_API_KEY=your-api-key
QWEN_API_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3-coder
CODE_GEN_MAX_TOKENS=8192

# GitHub Configuration
GITHUB_APP_ID=your-github-app-id
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_INSTALLATION_ID=your-installation-id
# Alternatively, use a Personal Access Token if not using a GitHub App

# Application Configuration
PORT=3000
LOG_LEVEL=info
GIT_WORKSPACE_DIR=/tmp/codepilot-workspaces


### 4. Running Locally

Start the Redis server (if not already running):
bash
docker run -p 6379:6379 -d redis:7-alpine


Start the Bot Server and Worker in development mode:
bash
pnpm dev
pnpm dev:worker


### 5. Running with Docker Compose

The project includes a `docker-compose.yml` that sets up the Bot, Worker, Redis, and a Cloudflare Tunnel (optional).

bash
docker-compose up -d


## 🛠 Development

- **Linting**: `pnpm lint` (Uses Biome)
- **Formatting**: `pnpm format`
- **Testing**: `pnpm test` (Uses Vitest)
- **Build**: `pnpm build`

## 📊 Observability

- **Health Checks**: Available at `GET /health`
- **Metrics**: Prometheus metrics are exposed at `GET /metrics`
  - Custom metrics include pipeline duration, AI request duration, circuit breaker state, queue jobs, etc.

## 🛡 Security

- **Code Validator**: Automatically scans generated code for dangerous patterns (`eval`, `exec`, `child_process`, `rm -rf /`, etc.) before applying.
- **Error Sanitizer**: Redacts sensitive information (Slack tokens, GitHub tokens, API keys, Private keys) from logs and Slack notifications.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
