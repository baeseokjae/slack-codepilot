# slack-codepilot

Slack AI agent bot for automating feature and bug fix requests.

## Overview

`slack-codepilot` is an intelligent Slack bot that listens to feature requests or bug reports, parses them using an LLM (Qwen), and automatically executes a pipeline to create a GitHub issue, clone the repository, generate code changes, push them to a new branch, and create a Pull Request.

## Features

- **Conversational Interface**: Interact with the bot via Slack threads to clarify requirements.
- **Automated Pipeline**:
  1. **Create Issue**: Creates a GitHub issue based on the parsed request.
  2. **Clone Repo**: Clones the target repository locally.
  3. **Generate Code**: Uses AI to generate the necessary code changes.
  4. **Apply & Push**: Validates, applies the changes, and pushes to a new branch.
  5. **Create PR**: Opens a Pull Request linking to the created issue.
- **Resilience & Observability**:
  - Circuit Breaker & Rate Limiter for API calls.
  - Prometheus metrics for pipeline duration, AI requests, and GitHub API usage.
  - Health checks for Redis and BullMQ.
  - Structured logging with Pino.
- **Security**:
  - Code validation to prevent dangerous patterns (e.g., `eval`, `rm -rf /`).
  - Error sanitization to mask sensitive tokens in logs and Slack messages.

## Architecture

The project consists of two main components communicating via Redis (BullMQ):
1. **Slack Bot (`src/server.ts`)**: Handles Slack events, commands, and interactions. Parses requests and enqueues jobs.
2. **Worker (`src/worker.ts`)**: Processes background jobs, executing the code generation pipeline.

## Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.15.4
- Redis
- Slack App Token & Bot Token
- GitHub App / Personal Access Token
- Qwen API Key (or compatible LLM API)

## Environment Variables

Create a `.env` file based on the configuration in `src/config/index.ts`:

env
# Slack Configuration
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-... # Optional, for Socket Mode

# Redis Configuration
REDIS_URL=redis://localhost:6379

# AI Configuration (Qwen)
QWEN_API_KEY=...
QWEN_API_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3-coder
CODE_GEN_MAX_TOKENS=8192

# GitHub Configuration
GITHUB_APP_ID=...
GITHUB_PRIVATE_KEY=...
GITHUB_INSTALLATION_ID=...

# Application Configuration
LOG_LEVEL=info
PORT=3000
GIT_WORKSPACE_DIR=/tmp/codepilot-workspaces


## Running the Project

### Using Docker Compose

The easiest way to run the project is using Docker Compose, which sets up the Slack bot, worker, Redis, and a Cloudflare tunnel.

bash
docker-compose up -d


### Local Development

1. Install dependencies:
   bash
   pnpm install
   

2. Start Redis (if not running via Docker):
   bash
   docker run -p 6379:6379 -d redis:7-alpine
   

3. Run the Slack bot in development mode:
   bash
   pnpm dev
   

4. Run the worker in development mode:
   bash
   pnpm dev:worker
   

## Project Structure

- `src/config/`: Environment variable validation and configuration.
- `src/lib/`: Core utilities (Circuit Breaker, Rate Limiter, Logger, Metrics, Health, Code Validator, Error Sanitizer).
- `src/parser/`: AI-based request parsing and follow-up generation.
- `src/pipeline/`: Orchestrator and individual steps for the code generation pipeline.
- `src/prompts/`: System prompts for the LLM.
- `src/services/`: External service integrations (AI, GitHub, Slack, Queue, State).
- `src/slack/`: Slack event handlers, blocks, and conversation management.
- `src/types/`: Shared TypeScript definitions.
