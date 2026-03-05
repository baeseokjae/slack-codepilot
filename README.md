# CodePilot

![CodePilot Logo](https://raw.githubusercontent.com/baeseokjae/codepilot/main/assets/codepilot-logo.png)

CodePilot는 Slack에서 AI 에이전트를 통해 기능 추가, 버그 수정 등의 개발 요청을 자동화하는 봇입니다. 자연어 요청을 받아 코드를 생성하고, GitHub에 이슈 및 Pull Request를 생성하여 개발 프로세스를 간소화합니다.

## ✨ 주요 기능

*   **자연어 요청 처리**: Slack에서 자연어로 개발 요청을 하면 AI가 이를 파싱하여 작업 계획을 수립합니다.
*   **코드 생성 및 적용**: AI가 요청에 따라 코드를 생성하고, 지정된 GitHub 저장소에 변경 사항을 적용합니다.
*   **GitHub 통합**: GitHub 이슈 생성, 브랜치 생성, 코드 푸시, Pull Request 생성 등 GitHub 작업을 자동화합니다.
*   **진행 상황 알림**: Slack을 통해 작업의 시작, 진행, 완료, 실패, 취소 등 실시간 상태를 알림으로 제공합니다.
*   **안전성 및 모니터링**: 위험한 코드 패턴 검증, 서킷 브레이커, Rate Limiter, Prometheus 메트릭을 통한 시스템 모니터링 기능을 제공합니다.

## 🏗️ 아키텍처 개요

CodePilot은 다음과 같은 주요 구성 요소로 이루어져 있습니다:

*   **Slack Bot (`src/server.ts`)**: Slack 이벤트(멘션, 메시지 등)를 수신하고 사용자 요청을 처리합니다. AI 파싱을 통해 작업 데이터를 생성하고, 이를 큐에 추가합니다.
*   **Worker (`src/worker.ts`)**: BullMQ 큐에서 작업을 가져와 실제 코드 생성 및 GitHub 작업을 수행하는 핵심 로직입니다. 각 작업은 파이프라인 형태로 순차적으로 실행됩니다.
*   **Redis**: BullMQ의 메시지 큐 및 파이프라인 상태 저장을 위한 데이터 스토어로 사용됩니다.
*   **GitHub App**: GitHub API와 상호작용하여 저장소 클론, 브랜치 생성, 파일 변경, 커밋, 푸시, Pull Request 생성 등의 작업을 수행합니다.
*   **AI Service (Qwen)**: 사용자 요청 파싱 및 코드 생성을 담당하는 LLM(Large Language Model) 서비스입니다.

mermaid
graph TD
    User[사용자] -- Slack 메시지 --> SlackBot(Slack Bot)
    SlackBot -- 작업 생성 --> RedisQueue(Redis Queue)
    RedisQueue -- 작업 처리 --> Worker(Worker)
    Worker -- 코드 생성 --> AIService(AI Service)
    Worker -- Git 작업 --> GitHubApp(GitHub App)
    GitHubApp -- 저장소 상호작용 --> GitHubRepo[GitHub Repository]
    Worker -- 상태 업데이트 --> RedisState(Redis State)
    RedisState -- 상태 조회 --> SlackBot
    SlackBot -- 진행 상황 알림 --> User


## 🚀 시작하기 (로컬 개발)

### 전제 조건

*   [Node.js](https://nodejs.org/en/) (v20 이상)
*   [pnpm](https://pnpm.io/) (v9 이상)
*   [Docker](https://www.docker.com/) 및 [Docker Compose](https://docs.docker.com/compose/) (선택 사항, Redis 및 Cloudflare Tunnel 사용 시)
*   [Git](https://git-scm.com/)

### 1. 환경 변수 설정

`.env` 파일을 프로젝트 루트에 생성하고 다음 변수들을 설정합니다. 예시 `.env.example` 파일을 참고하세요.

dotenv
# Slack App Credentials
SLACK_BOT_TOKEN=xoxb-YOUR_BOT_TOKEN
SLACK_SIGNING_SECRET=YOUR_SIGNING_SECRET
SLACK_APP_TOKEN=xapp-YOUR_APP_TOKEN # Socket Mode 사용 시 필요

# Redis Connection
REDIS_URL=redis://localhost:6379

# AI Service (Qwen)
QWEN_API_KEY=sk-YOUR_QWEN_API_KEY
QWEN_API_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3-coder

# GitHub App Credentials (GitHub App을 사용하는 경우)
GITHUB_APP_ID=YOUR_GITHUB_APP_ID
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nYOUR_PRIVATE_KEY_CONTENT\n-----END RSA PRIVATE KEY-----"
GITHUB_INSTALLATION_ID=YOUR_GITHUB_INSTALLATION_ID

# Cloudflare Tunnel (선택 사항, Slack Webhook을 로컬로 전달할 때 사용)
CF_TUNNEL_TOKEN=YOUR_CLOUDFLARE_TUNNEL_TOKEN

# 기타 설정
LOG_LEVEL=info
PORT=3000
GIT_WORKSPACE_DIR=/tmp/codepilot-workspaces
CODE_GEN_MAX_TOKENS=8192
SHUTDOWN_TIMEOUT_MS=30000


**GitHub App 설정**: GitHub App을 생성하고, `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_INSTALLATION_ID`를 `.env` 파일에 추가해야 합니다. 자세한 내용은 [GitHub App 문서](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/about-creating-github-apps)를 참조하세요.

**Slack App 설정**: Slack App을 생성하고, Bot Token, Signing Secret, App Token을 설정해야 합니다. 이벤트 구독 및 소켓 모드 활성화가 필요합니다. 자세한 내용은 [Slack Bolt 문서](https://slack.dev/bolt-js/tutorial/getting-started)를 참조하세요.

### 2. 의존성 설치

bash
pnpm install


### 3. 서비스 실행

#### Docker Compose로 실행 (권장)

Redis, Slack Bot, Worker, Cloudflare Tunnel을 한 번에 실행합니다.

bash
docker compose up --build


#### 개별적으로 실행 (로컬 Node.js 환경)

1.  **Redis 실행** (Docker 또는 로컬 설치)

    bash
docker run --name codepilot-redis -p 6379:6379 redis:7-alpine
    

2.  **Slack Bot 실행**

    bash
pnpm run dev
    

3.  **Worker 실행**

    bash
pnpm run dev:worker
    

## 🤖 사용법

Slack 채널에서 CodePilot 봇을 멘션하여 작업을 요청합니다.

예시:

*   `@codepilot auth-service 레포에 로그인 버그 수정해줘. 500 에러가 발생해.`
*   `@codepilot user-service 레포에 새로운 사용자 등록 기능을 추가해줘.`
*   `@codepilot docs 레포에 README.md 파일 업데이트해줘.`

봇은 요청을 파싱하고, 필요한 경우 추가 정보를 질문할 수 있습니다. 작업이 시작되면 진행 상황을 실시간으로 알림으로 제공하며, 완료 시 GitHub 이슈 및 Pull Request 링크를 공유합니다.

## 🤝 기여하기

기여를 환영합니다! 코드 변경을 제출하기 전에 `AGENTS.md`에 명시된 코딩 행동 정책을 숙지해 주세요.

## 📄 라이선스

이 프로젝트는 MIT 라이선스에 따라 배포됩니다. 자세한 내용은 `LICENSE` 파일을 참조하세요.
