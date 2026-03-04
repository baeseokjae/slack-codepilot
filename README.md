# CodePilot: Slack AI Agent for Automated Development

CodePilot is a Slack AI agent bot designed to automate feature and bug fix requests directly from Slack. It integrates with GitHub to create issues, generate code, apply changes, and open pull requests, streamlining the development workflow.

## ✨ Features

*   **Natural Language Request Parsing**: Understands development tasks described in natural language via Slack.
*   **Automated GitHub Workflow**:
    *   Creates GitHub issues for new tasks.
    *   Clones repositories and generates code changes.
    *   Applies code changes and pushes to a new branch.
    *   Opens pull requests for review.
*   **Interactive Feedback**: Provides real-time progress updates and notifications in Slack.
*   **Safety Checks**: Validates generated code for dangerous patterns before applying changes.
*   **Extensible Pipeline**: Modular pipeline architecture allows for easy addition or modification of steps.

## 🏗️ Architecture

CodePilot consists of several components orchestrated via Docker Compose:

*   **Slack Bot (`slack-bot`)**: The primary interface, handling Slack events (mentions, commands) and parsing user requests. It enqueues tasks to the worker.
*   **Worker (`worker`)**: Processes development tasks from the queue. It interacts with AI models (Qwen), GitHub, and the local filesystem to perform code generation, repository operations, and PR creation.
*   **Redis**: Used as a message broker for BullMQ (task queue) and for storing pipeline state.
*   **Cloudflare Tunnel (`tunnel`)**: (Optional) Exposes the local Slack Bot to the internet securely, necessary for Slack to send events to a local development environment.

mermaid
graph TD
    User[Slack User] -->|Mentions @CodePilot| Slack[Slack Platform]
    Slack -->|Event (HTTP)| SlackBot[Slack Bot]
    SlackBot -->|Enqueue Task| Redis[Redis Queue]
    Redis -->|Dequeue Task| Worker[Worker]
    Worker -->|AI API Call| LLM[Qwen API]
    Worker -->|GitHub API Call| GitHub[GitHub]
    Worker -->|Git Operations| GitHub
    Worker -->|Update Progress| SlackBot
    SlackBot -->|Notify User| Slack


## 🚀 Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

*   [Node.js](https://nodejs.org/) (v20 or higher)
*   [pnpm](https://pnpm.io/)
*   [Docker](https://www.docker.com/products/docker-desktop/) & [Docker Compose](https://docs.docker.com/compose/)
*   A Slack Workspace where you can create a Slack App.
*   A GitHub App with necessary permissions (see below).
*   An API Key for Qwen (e.g., from Alibaba Cloud DashScope).
*   (Optional) A Cloudflare Tunnel token if you need to expose your local bot to Slack.

### 1. Environment Variables

Create a `.env` file in the root directory of the project based on the example below:

dotenv
# Slack App Credentials
SLACK_BOT_TOKEN=xoxb-YOUR_BOT_TOKEN
SLACK_SIGNING_SECRET=YOUR_SIGNING_SECRET
SLACK_APP_TOKEN=xapp-YOUR_APP_TOKEN # For Socket Mode, optional for HTTP

# Redis
REDIS_URL=redis://redis:6379 # Default for Docker Compose

# Qwen AI API
QWEN_API_KEY=sk-YOUR_QWEN_API_KEY
QWEN_API_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1 # Default
QWEN_MODEL=qwen3-coder # Default

# GitHub App Credentials
# Required for GitHub integration (creating issues, PRs, cloning repos)
GITHUB_APP_ID=YOUR_GITHUB_APP_ID
GITHUB_PRIVATE_KEY="""-----BEGIN RSA PRIVATE KEY-----
YOUR_PRIVATE_KEY_CONTENT
-----END RSA PRIVATE KEY-----"""
GITHUB_INSTALLATION_ID=YOUR_GITHUB_INSTALLATION_ID

# Worker Configuration
GIT_WORKSPACE_DIR=/tmp/codepilot-workspaces # Default for Docker Compose
CODE_GEN_MAX_TOKENS=8192 # Max tokens for AI code generation
SHUTDOWN_TIMEOUT_MS=30000 # Graceful shutdown timeout

# Logging
LOG_LEVEL=info # fatal, error, warn, info, debug, trace

# Cloudflare Tunnel (Optional, for local development with Slack HTTP events)
CF_TUNNEL_TOKEN=YOUR_CLOUDFLARE_TUNNEL_TOKEN


**GitHub App Setup:**
1.  Go to your GitHub profile settings -> Developer settings -> GitHub Apps.
2.  Create a new GitHub App.
3.  **Permissions**:
    *   `Contents`: Read & Write (for cloning, pushing, creating files)
    *   `Issues`: Read & Write (for creating issues)
    *   `Pull requests`: Read & Write (for creating PRs)
    *   `Metadata`: Read-only (default)
4.  **Webhook**: Disable webhook (CodePilot uses API directly).
5.  Generate a new private key and save its content to `GITHUB_PRIVATE_KEY` in your `.env` file. Ensure it's a multi-line string if your `.env` parser supports it, or replace newlines with `\n`.
6.  Note down the `App ID` and `Installation ID` (after installing the app on a repository/organization) and set them in your `.env`.

**Slack App Setup:**
1.  Create a new Slack App from scratch.
2.  **Features -> OAuth & Permissions**:
    *   **Bot Token Scopes**: `app_mentions:read`, `chat:write`, `commands`, `im:history`, `mpim:history`, `channels:history`, `groups:history`
3.  **Features -> Event Subscriptions**:
    *   Enable Events.
    *   Set Request URL to your bot's public URL (e.g., `https://your-tunnel-url.trycloudflare.com/slack/events`).
    *   **Subscribe to bot events**: `app_mention`, `message.channels`, `message.groups`, `message.im`, `message.mpim`
4.  **Features -> Slash Commands**:
    *   Create a new command, e.g., `/codepilot`.
    *   Set Request URL to your bot's public URL (e.g., `https://your-tunnel-url.trycloudflare.com/slack/commands`).
5.  **Features -> Interactivity & Shortcuts**:
    *   Enable Interactivity.
    *   Set Request URL to your bot's public URL (e.g., `https://your-tunnel-url.trycloudflare.com/slack/actions`).
6.  Install the app to your workspace.
7.  Copy the `Bot User OAuth Token` (starts with `xoxb-`) to `SLACK_BOT_TOKEN`.
8.  Copy the `Signing Secret` to `SLACK_SIGNING_SECRET`.
9.  (Optional, for Socket Mode) If you want to use Socket Mode instead of HTTP events, enable Socket Mode under "Basic Information" and generate an `App-Level Token` (starts with `xapp-`) for `SLACK_APP_TOKEN`. Then, you don't need Cloudflare Tunnel.

### 2. Running with Docker Compose

bash
# Build and run all services
docker compose up --build

# To run in detached mode
docker compose up --build -d


The `slack-bot` will be accessible on `http://localhost:3000`. If you're using Cloudflare Tunnel, it will expose this port. The `worker` will automatically pick up jobs from Redis.

## 🤖 Usage

Once the bot is running and installed in your Slack workspace:

*   **Mention the bot**: `@CodePilot [your request]`
    *   Example: `@CodePilot "Add a new API endpoint /users that returns a list of users from the database in the user-service repository."`
*   **Use the slash command**: `/codepilot [your request]`
    *   Example: `/codepilot "Fix the login bug where users get a 500 error when entering an incorrect password in the auth-service repository."`

The bot will respond in the thread, providing updates on the pipeline's progress.

## ⚙️ Configuration

All configuration is managed via environment variables. See `src/config/index.ts` for a complete list and their default values.

## 🤝 Contributing

We welcome contributions! Please refer to `AGENTS.md` for guidelines on coding behavior and best practices when working on CodePilot.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
