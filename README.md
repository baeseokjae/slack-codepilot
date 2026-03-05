# CodePilot

AI 기반 Slack 봇으로, 소프트웨어 개발 작업을 자동화합니다. 자연어 요청을 이해하여 GitHub에서 이슈를 생성하고, 코드를 생성 및 적용하며, 풀 리퀘스트를 여는 등 전체 개발 파이프라인을 Slack을 통해 오케스트레이션합니다.

## ✨ 주요 기능

*   **AI 기반 작업 실행**: 자연어 요청을 이해하여 기능 추가, 버그 수정, 리팩토링, 문서 작성, 테스트 코드 작성 등 다양한 코딩 작업을 수행합니다.
*   **GitHub 통합**: GitHub 이슈 생성, 리포지토리 클론, 코드 변경 사항 적용, 브랜치 푸시, 풀 리퀘스트 생성 등 GitHub 워크플로우를 자동화합니다.
*   **Slack 상호작용**: Slack 멘션에 응답하고, 작업 진행 상황을 실시간으로 업데이트하며, 추가 정보가 필요할 때 후속 질문을 통해 대화를 이어갑니다.
*   **견고성**: 서킷 브레이커, 레이트 리미터, 그리고 잠재적으로 위험한 코드 패턴을 검증하는 보안 유효성 검사 기능을 내장하여 안정적이고 안전한 운영을 보장합니다.
*   **관측 가능성**: Prometheus 메트릭, 구조화된 로깅 (Pino), 헬스 체크를 통해 시스템 상태를 쉽게 모니터링할 수 있습니다.
*   **확장성**: BullMQ를 사용하여 백그라운드 작업을 처리하고, 작업 부하에 따라 워커를 확장할 수 있도록 설계되었습니다.

## 🏗️ 아키텍처 개요

CodePilot은 다음과 같은 주요 구성 요소로 이루어져 있습니다.

*   **Slack Bot**: Slack 이벤트 (멘션, 명령어)를 수신하고, 사용자 요청을 파싱하며, 처리할 작업을 큐에 추가합니다.
*   **Worker**: 큐에서 작업을 가져와 코드 생성 파이프라인을 오케스트레이션하고, GitHub 및 AI 서비스와 상호작용합니다.
*   **Redis**: BullMQ의 작업 큐 관리 및 파이프라인 상태 저장을 위해 사용됩니다.
*   **GitHub App**: GitHub 리포지토리에 대한 인증된 접근을 제공하여 클론, 커밋, 푸시, PR/이슈 생성 등의 작업을 수행합니다.

## 🚀 시작하기

### 전제 조건

*   Node.js (v20 이상)
*   pnpm (v9 이상)
*   Docker & Docker Compose
*   Git

### 1. 환경 변수 (`.env`) 설정

프로젝트 루트 디렉토리에 `.env` 파일을 생성하고 다음 변수들을 설정합니다.

env
# Slack App Credentials
SLACK_BOT_TOKEN=xoxb-YOUR_BOT_TOKEN
SLACK_SIGNING_SECRET=YOUR_SIGNING_SECRET
SLACK_APP_TOKEN=xapp-YOUR_APP_TOKEN # 소켓 모드 사용 시 필요, HTTP 사용 시 선택 사항

# AI 서비스 (Qwen/Tongyi Qianwen)
QWEN_API_KEY=sk-YOUR_QWEN_API_KEY
QWEN_API_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1 # 기본값, 필요한 경우 변경
QWEN_MODEL=qwen3-coder # 기본값, 필요한 경우 변경

# Redis
REDIS_URL=redis://localhost:6379 # 기본값, 필요한 경우 변경

# GitHub App Credentials (선택 사항이지만 GitHub 통합에 필수)
GITHUB_APP_ID=YOUR_GITHUB_APP_ID
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END RSA PRIVATE KEY-----" # 여러 줄의 키는 \n으로 구분하고 전체를 큰따옴표로 묶습니다.
GITHUB_INSTALLATION_ID=YOUR_GITHUB_INSTALLATION_ID # 특정 리포지토리 또는 조직에 대한 설치 ID

# Cloudflare Tunnel (선택 사항, 로컬 서비스를 Slack에 노출하기 위함)
CF_TUNNEL_TOKEN=YOUR_CLOUDFLARE_TUNNEL_TOKEN

# 로깅
LOG_LEVEL=info # 가능한 값: debug, info, warn, error, fatal

# 워커 특정 설정
GIT_WORKSPACE_DIR=/tmp/codepilot-workspaces # 리포지토리 클론을 위한 작업 디렉토리
CODE_GEN_MAX_TOKENS=8192 # AI 코드 생성에 사용될 최대 토큰 수
SHUTDOWN_TIMEOUT_MS=30000 # 서버/워커 종료 대기 시간 (ms)


### 2. GitHub App 설정

1.  GitHub 프로필 설정 → Developer settings → GitHub Apps로 이동합니다.
2.  "New GitHub App"을 클릭합니다.
3.  **GitHub App name**: `CodePilot` (또는 원하는 이름)
4.  **Homepage URL**: `https://github.com/your-org/codepilot` (또는 프로젝트 URL)
5.  **Webhook URL**: Cloudflare Tunnel을 사용하여 로컬에서 실행하는 경우 `https://YOUR_TUNNEL_ID.trycloudflare.com/slack/events`로 설정합니다. 배포하는 경우 배포된 서비스의 URL을 사용합니다.
6.  **Webhook secret**: 강력한 시크릿을 생성하고 `.env` 파일에 `GITHUB_WEBHOOK_SECRET`으로 추가합니다 (현재 코드에서는 사용되지 않지만 좋은 관행입니다).
7.  **Permissions (권한)**:
    *   `Contents`: Read & Write (클론, 커밋, 푸시용)
    *   `Issues`: Read & Write (이슈 생성용)
    *   `Pull requests`: Read & Write (PR 생성용)
    *   `Metadata`: Read-only (기본값)
8.  **Subscribe to events (이벤트 구독)**:
    *   `Push`
    *   `Issue comment`
    *   `Pull request`
9.  "Create GitHub App"을 클릭합니다.
10. 앱 페이지에서 **App ID**를 기록하고 `.env` 파일에 `GITHUB_APP_ID`로 추가합니다.
11. **Private key**를 생성하고 그 내용을 `.env` 파일에 `GITHUB_PRIVATE_KEY`로 저장합니다. 여러 줄의 키는 `\n`으로 구분하고 전체를 큰따옴표로 묶어야 합니다.
12. CodePilot이 작동할 리포지토리 또는 조직에 앱을 설치합니다. 설치 후 각 설치에 대한 **Installation ID**를 얻게 됩니다. 관련 ID를 `.env` 파일에 `GITHUB_INSTALLATION_ID`로 추가합니다.

### 3. Slack App 설정

1.  api.slack.com/apps로 이동하여 "Create New App"을 클릭합니다.
2.  "From an app manifest"를 선택하고 워크스페이스를 선택합니다.
3.  다음 매니페스트를 붙여넣습니다 (`display_information.name`은 필요에 따라 조정).

    yaml
    display_information:
      name: CodePilot
      description: AI-powered bot for automating software development tasks.
      background_color: "#222222"
    features:
      bot_user:
        display_name: CodePilot
        always_online: false
    oauth_config:
      scopes:
        bot:
          - app_mentions:read
          - chat:write
          - commands
          - im:history
          - mpim:history
          - channels:history
          - groups:history
    settings:
      event_subscriptions:
        request_url: https://YOUR_TUNNEL_ID.trycloudflare.com/slack/events # 실제 URL로 대체
        bot_events:
          - app_mention
          - message.channels
          - message.groups
          - message.im
          - message.mpim
      interactivity:
        is_enabled: true
        request_url: https://YOUR_TUNNEL_ID.trycloudflare.com/slack/events # 실제 URL로 대체
      org_deploy_enabled: false
      socket_mode_enabled: true # SLACK_APP_TOKEN 사용 시 활성화
      token_rotation_enabled: false
    
4.  앱 생성 후, "Basic Information" → "App-Level Tokens"로 이동하여 `connections:write` 스코프를 가진 새 토큰을 생성합니다. 이를 `.env` 파일에 `SLACK_APP_TOKEN`으로 추가합니다.
5.  "Install App" → "Install to Workspace"로 이동하여 앱을 승인합니다.
6.  **Bot User OAuth Token** (`xoxb-`로 시작)과 **Signing Secret**을 기록합니다. 이를 `.env` 파일에 각각 `SLACK_BOT_TOKEN`과 `SLACK_SIGNING_SECRET`으로 추가합니다.

### 4. Docker Compose로 실행 (로컬 개발 권장)

bash
docker-compose up --build


이 명령은 Slack 봇, 워커, Redis를 시작합니다. Cloudflare Tunnel을 사용하는 경우, `.env`에 `CF_TUNNEL_TOKEN`이 설정되어 있으면 `tunnel` 서비스도 함께 시작됩니다.

### 5. 로컬에서 실행 (Docker Compose 없이)

bash
# 의존성 설치
pnpm install

# TypeScript 빌드
pnpm build

# Slack 봇 서버 시작
pnpm start

# 별도의 터미널에서 워커 시작
pnpm start:worker


이 경우, 별도로 Redis 인스턴스를 실행해야 합니다 (예: `docker run -p 6379:6379 redis:7-alpine`).

## 🤖 사용법

Slack 채널에서 `@CodePilot`을 멘션하거나 다이렉트 메시지를 보내 요청을 전달합니다.

**예시**: `@CodePilot "`my-app` 리포지토리에 데이터베이스에서 사용자 목록을 반환하는 새 API 엔드포인트 `/users`를 추가해줘."`

## ⚙️ 설정

모든 설정 가능한 파라미터는 `src/config/index.ts`에 정의 및 검증된 환경 변수를 통해 관리됩니다.

## 🤝 기여하기

CodePilot에 기여할 때의 코딩 행동 및 기대치에 대한 지침은 `AGENTS.md` 파일을 참조하십시오.

## 📄 라이선스

이 프로젝트는 MIT 라이선스에 따라 배포됩니다. 자세한 내용은 `LICENSE` 파일을 참조하십시오.
