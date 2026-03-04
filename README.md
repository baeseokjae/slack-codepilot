# CodePilot: Slack AI Agent for Automated Development

## 🚀 Overview

CodePilot is a Slack-integrated AI agent designed to automate software development tasks, from feature requests and bug fixes to refactoring and documentation updates. By leveraging large language models (LLMs) and integrating with GitHub, CodePilot streamlines the development workflow, allowing teams to focus on higher-level problem-solving.

## ✨ Features

*   **Natural Language Tasking**: Submit development requests directly in Slack using natural language.
*   **Automated Code Generation**: AI generates code changes based on parsed requests.
*   **GitHub Integration**:
    *   Clones repositories.
    *   Creates new branches.
    *   Applies code changes.
    *   Pushes changes to GitHub.
    *   Opens Pull Requests (PRs) or Issues.
*   **Real-time Progress Updates**: Receive Slack notifications on the status of ongoing tasks.
*   **Safety Checks**: Validates generated code for dangerous patterns before application.
*   **Extensible Pipeline**: Modular design for easy addition of new steps and integrations.
*   **Observability**: Prometheus metrics for monitoring performance and health.

## 🏗️ Architecture

CodePilot consists of two main components:

1.  **Slack Bot (`server.ts`)**:
    *   Listens for Slack events (mentions, commands).
    *   Parses user requests using an LLM.
    *   Enqueues development tasks into a Redis-backed queue (BullMQ).
    *   Provides real-time updates and interactive elements in Slack.
2.  **Worker (`worker.ts`)**:
    *   Picks up tasks from the queue.
    *   Orchestrates the development pipeline:
        *   Clones the target repository.
        *   Generates code using an LLM.
        *   Applies changes, commits, and pushes to a new branch.
        *   Creates a Pull Request or GitHub Issue.
    *   Communicates progress and results back to the Slack bot.

**Supporting Services**:
*   **Redis**: Used as a message broker for BullMQ and for storing pipeline state.
*   **GitHub App**: Authenticates and interacts with GitHub repositories.
*   **LLM Provider**: Currently configured for Qwen models via DashScope API.
*   **Cloudflare Tunnel (Optional)**: For exposing the local Slack bot to the internet during development.

mermaid
graph TD
    User[Slack User] -->|Mentions/Commands| SlackAPI[Slack API]
    SlackAPI -->|Events| SlackBot[Slack Bot (server.ts)]
    SlackBot -->|Parse Request (LLM)| LLM[LLM Provider]
    SlackBot -->|Enqueue Task| Redis[Redis (BullMQ)]
    Redis -->|Dequeue Task| Worker[Worker (worker.ts)]
    Worker -->|Clone/Push/PR| GitHub[GitHub API]
    Worker -->|Generate Code (LLM)| LLM
    Worker -->|Update State| Redis
    Worker -->|Notify Progress| SlackBot
    SlackBot -->|Send Messages/Blocks| SlackAPI
    SlackAPI --> User


## ⚙️ Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

*   [Node.js](https://nodejs.org/en/) (v20 or higher)
*   [pnpm](https://pnpm.io/) (v9 or higher)
*   [Docker](https://www.docker.com/products/docker-desktop/) & [Docker Compose](https://docs.docker.com/compose/)
*   [Git](https://git-scm.com/)

### 1. Environment Variables

Create a `.env` file in the root directory of the project. You'll need to fill in the following:

dotenv
# Slack App Credentials
SLACK_BOT_TOKEN=xoxb-YOUR_BOT_TOKEN
SLACK_SIGNING_SECRET=YOUR_SIGNING_SECRET
# SLACK_APP_TOKEN=xapp-YOUR_APP_TOKEN # Only needed for Socket Mode

# AI Provider (Qwen via DashScope)
QWEN_API_KEY=sk-YOUR_QWEN_API_KEY
# QWEN_API_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1 # Default
# QWEN_MODEL=qwen3-coder # Default

# GitHub App Credentials (Optional, for GitHub integration)
# If you want to enable GitHub integration, you need to create a GitHub App.
# See: https://docs.github.com/en/apps/creating-github-apps/setting-up-a-github-app/creating-a-github-app
GITHUB_APP_ID=YOUR_GITHUB_APP_ID
GITHUB_PRIVATE_KEY="""-----BEGIN RSA PRIVATE KEY-----
YOUR_PRIVATE_KEY_CONTENT
-----END RSA PRIVATE KEY-----"""
GITHUB_INSTALLATION_ID=YOUR_GITHUB_APP_INSTALLATION_ID

# Redis (used by BullMQ for queue and state management)
# REDIS_URL=redis://localhost:6379 # Default

# Cloudflare Tunnel (Optional, for exposing local bot to Slack)
# CF_TUNNEL_TOKEN=YOUR_CLOUDFLARE_TUNNEL_TOKEN


**Important Notes for GitHub App**:
*   The `GITHUB_PRIVATE_KEY` should be the *entire* content of your `.pem` file, including `-----BEGIN...` and `-----END...` lines. Ensure it's enclosed in triple quotes (`"""`).
*   The GitHub App needs permissions for `contents` (read & write), `issues` (read & write), and `pull_requests` (read & write).
*   The GitHub App needs to be installed on the target repositories.

### 2. Running with Docker Compose (Recommended for Local Dev)

This method sets up all services (bot, worker, Redis, and optionally Cloudflare Tunnel) with a single command.

1.  **Build and Run**:
    bash
    docker compose up --build
    
2.  **Expose to Slack (if using Cloudflare Tunnel)**:
    If you've configured `CF_TUNNEL_TOKEN` in your `.env`, the `tunnel` service will automatically expose your local bot to the internet. You'll need to configure your Slack App's Request URL to point to your Cloudflare Tunnel URL (e.g., `https://<your-tunnel-id>.trycloudflare.com/slack/events`).

### 3. Running Locally (without Docker Compose)

If you prefer to run the Node.js applications directly:

1.  **Install Dependencies**:
    bash
    pnpm install
    
2.  **Start Redis**:
    You'll need a running Redis instance. You can use Docker:
    bash
    docker run --name codepilot-redis -p 6379:6379 -d redis:7-alpine redis-server --appendonly yes
    
3.  **Start the Slack Bot**:
    bash
    pnpm dev
    
    The bot will listen on `http://localhost:3000`. You'll need to expose this to Slack using a tool like `ngrok` or `Cloudflare Tunnel` if you're not using Socket Mode.
4.  **Start the Worker**:
    bash
    pnpm dev:worker
    

## 🤖 Usage

Once the bot is running and connected to Slack:

*   **Mention the bot**: `@codepilot [your request]`
    *   Example: `@codepilot "Add a new API endpoint /users that returns a list of all users from the database in the 'user-service' repository."`
    *   Example: `@codepilot "Fix the bug where login fails with a 500 error when an invalid password is provided in the 'auth-service' repository."`
*   **Follow-up questions**: The bot might ask for more information if the initial request is ambiguous or incomplete.
*   **Cancellation**: You can cancel an ongoing task by interacting with the bot's messages (e.g., via a button).

## 📝 Configuration

Key configurations are managed via environment variables, as defined in `src/config/index.ts`.

*   `LOG_LEVEL`: Adjust logging verbosity (e.g., `debug`, `info`, `warn`, `error`).
*   `CODE_GEN_MAX_TOKENS`: Maximum tokens for AI code generation.
*   `GIT_WORKSPACE_DIR`: Directory where repositories are cloned for processing (default: `/tmp/codepilot-workspaces`).

## 🤝 Contributing

We welcome contributions! Please refer to `AGENTS.md` for guidelines on coding behavior and best practices when working with LLMs.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
