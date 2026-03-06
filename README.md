# CodePilot: AI-Powered Software Development Agent for Slack

CodePilot는 AI 기반 Slack 봇으로, 기능 요청 및 버그 수정부터 리팩토링 및 문서 업데이트에 이르기까지 소프트웨어 개발 작업을 자동화하도록 설계되었습니다. GitHub와 통합되어 이슈를 생성하고, 코드를 생성하며, 변경 사항을 적용하고, Pull Request를 열어 Slack에서 직접 개발 워크플로우를 간소화합니다.

## 주요 기능

*   **AI 기반 코드 생성**: 자연어 요청을 이해하고 코드 변경 사항을 생성합니다.
*   **GitHub 통합**:
    *   새로운 작업을 위한 GitHub Issue를 생성합니다.
    *   리포지토리를 클론하고, 코드 변경 사항을 적용하며, 새 브랜치에 푸시합니다.
    *   검토를 위한 Pull Request를 엽니다.
*   **Slack 상호 작용**:
    *   Slack 멘션을 통해 개발 요청을 수신하고 처리합니다.
    *   작업 진행 상황에 대한 실시간 업데이트를 제공합니다.
    *   명확화를 위한 후속 질문을 지원합니다.
*   **코드 유효성 검사**: 잠재적으로 유해한 코드(예: `rm -rf /`, `eval()`) 생성을 방지하기 위한 안전 검사를 구현합니다.
*   **관찰 가능성**: 모니터링을 위한 메트릭(Prometheus) 및 구조화된 로깅(Pino).
*   **복원력**: 외부 API 호출을 위한 서킷 브레이커 및 Rate Limiter.

## 아키텍처 개요

CodePilot은 두 가지 주요 구성 요소로 구성됩니다:

*   **Slack 봇 (`server.ts`)**: 들어오는 Slack 이벤트를 처리하고, AI를 사용하여 사용자 요청을 파싱하며, 작업자 큐에 작업을 디스패치합니다.
*   **작업자 (`worker.ts`)**: 큐에서 작업을 처리하고, 코드 생성 파이프라인(리포지토리 클론, 코드 생성, 변경 사항 적용, 푸시, PR 생성)을 오케스트레이션하며, GitHub 및 AI 서비스와 상호 작용합니다.
*   **Redis**: BullMQ(작업 큐)의 메시지 브로커 및 파이프라인 상태 저장을 위해 사용됩니다.
*   **GitHub 앱**: GitHub 리포지토리와 인증 및 상호 작용합니다.
*   **AI 서비스**: 요청을 이해하고 코드를 생성하기 위한 대규모 언어 모델 기능을 제공합니다.

mermaid
graph TD
    User[Slack User] -- Mentions/Commands --> SlackApp[Slack App]
    SlackApp -- Events/Interactions --> SlackBot[CodePilot Slack Bot (server.ts)]
    SlackBot -- Dispatches Task --> RedisQueue[Redis (BullMQ)]
    RedisQueue -- Processes Task --> Worker[CodePilot Worker (worker.ts)]
    Worker -- API Calls --> GitHub[GitHub API]
    Worker -- API Calls --> AIService[AI Service (OpenAI/Vertex)]
    Worker -- Updates --> SlackBot
    SlackBot -- Notifies Progress/Completion --> SlackApp
    SlackApp -- Displays Updates --> User


## 시작하기

### 전제 조건

*   Node.js (v20 이상)
*   pnpm (v9 이상)
*   Docker & Docker Compose
*   **GitHub 앱**:
    *   조직/계정 설정에서 새 GitHub 앱을 생성합니다.
    *   권한 구성:
        *   `Contents`: 읽기 및 쓰기
        *   `Issues`: 읽기 및 쓰기
        *   `Pull requests`: 읽기 및 쓰기
        *   `Repository metadata`: 읽기 전용
    *   이벤트 구독: `Push`, `Pull request`, `Issues`.
    *   개인 키(`.pem` 파일)를 생성하고 앱 ID를 기록합니다.
    *   CodePilot이 관리해야 하는 리포지토리에 앱을 설치합니다. 설치 ID를 기록합니다.
*   **Slack 앱**:
    *   새 Slack 앱을 생성합니다.
    *   `Socket Mode`를 활성화합니다.
    *   봇 토큰 스코프 추가: `app_mentions:read`, `chat:write`, `commands`.
    *   앱 레벨 토큰(`xapp-***`) 및 봇 사용자 OAuth 토큰(`xoxb-***`)을 생성합니다.
    *   서명 비밀(`Signing Secret`)을 기록합니다.
    *   작업 공간에 앱을 설치합니다.

### 환경 변수

프로젝트 루트에 다음 변수를 포함하는 `.env` 파일을 생성합니다:

dotenv
# Slack App Credentials
SLACK_BOT_TOKEN=xoxb-YOUR_SLACK_BOT_TOKEN
SLACK_SIGNING_SECRET=YOUR_SLACK_SIGNING_SECRET
SLACK_APP_TOKEN=xapp-YOUR_SLACK_APP_TOKEN # Required for Socket Mode

# Redis
REDIS_URL=redis://redis:6379 # For Docker Compose, use 'redis://redis:6379'

# AI Service (Choose one: OpenAI or Vertex AI)
AI_PROVIDER=openai # or 'vertex'

# OpenAI Configuration (if AI_PROVIDER=openai)
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
OPENAI_BASE_URL=https://api.openai.com/v1 # Or your custom endpoint (e.g., for Qwen)
OPENAI_MODEL=gpt-4o # Or 'qwen3-coder', 'claude-3-opus-20240229', etc.

# Vertex AI Configuration (if AI_PROVIDER=vertex)
# VERTEX_PROJECT_ID=your-gcp-project-id
# VERTEX_LOCATION=us-central1
# VERTEX_MODEL=google/gemini-2.5-flash # Or 'claude-3-opus-20240229' (for Anthropic on Vertex)

# GitHub App Configuration
GITHUB_APP_ID=YOUR_GITHUB_APP_ID
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nYOUR_PRIVATE_KEY_CONTENT\n-----END RSA PRIVATE KEY-----"
GITHUB_INSTALLATION_ID=YOUR_GITHUB_INSTALLATION_ID # Specific to the repo/org
GITHUB_DEFAULT_ORG=your-github-org # Optional: Default organization for repos
GITHUB_REVIEW_TEAM=your-review-team # Optional: Team to request reviews from

# Worker Configuration
GIT_WORKSPACE_DIR=/tmp/codepilot-workspaces # Directory for cloning repos in worker

# Optional: Slack User to GitHub User Mapping (JSON string)
# SLACK_GITHUB_USER_MAP={"U123":"github-user-1","U456":"github-user-2"}


### Docker Compose로 실행

1.  Docker 및 Docker Compose가 설치되어 있는지 확인합니다.
2.  위에 설명된 대로 `.env` 파일을 생성합니다.
3.  서비스를 빌드하고 실행합니다:
    bash
    docker compose up --build
    
    이렇게 하면 Slack 봇, 작업자 및 Redis가 시작됩니다.
4.  로컬 개발의 경우, Socket Mode를 사용하지 않는다면 Slack 봇을 인터넷에 노출하기 위해 터널(예: Cloudflare Tunnel, ngrok)이 필요할 수 있습니다. `docker-compose.yml`에는 Cloudflare Tunnel을 위한 `tunnel` 서비스가 포함되어 있습니다. 사용하려면 `.env`에 `CF_TUNNEL_TOKEN`을 설정하세요.

## 사용법

Slack 채널에서 봇을 멘션하고 작업을 설명하세요.

*   **기능 요청**: `@codepilot 새로운 사용자 관리 기능 추가해줘`
*   **버그 수정**: `@codepilot 로그인 페이지에서 500 에러 발생해. 수정해줘`
*   **리팩토링**: `@codepilot auth-service 레포지토리의 인증 로직 리팩토링해줘`
*   **문서화**: `@codepilot README.md 파일에 설치 방법 추가해줘`

봇은 필요한 경우 명확한 질문을 하고, 진행 상황 업데이트를 제공하며, GitHub Issue 및 Pull Request 링크와 함께 완료 시 알림을 보냅니다.

## 개발

1.  리포지토리 클론:
    bash
    git clone https://github.com/your-org/codepilot.git
    cd codepilot
    
2.  의존성 설치:
    bash
    pnpm install
    
3.  Slack 봇 로컬 실행(`.env` 설정 및 Slack 이벤트를 위한 터널 필요):
    bash
    pnpm dev
    
4.  작업자 로컬 실행(`.env` 설정 및 Redis 실행 필요):
    bash
    pnpm dev:worker
    
5.  테스트 실행:
    bash
    pnpm test
    
6.  린트 및 포맷:
    bash
    pnpm lint
    pnpm format
    

## 기여

AI 에이전트(및 인간 기여자)가 코딩 작업에 접근하는 방법에 대한 지침은 `AGENTS.md`를 참조하십시오.

## 라이선스

이 프로젝트는 MIT 라이선스에 따라 라이선스가 부여됩니다. 자세한 내용은 `LICENSE` 파일을 참조하십시오.
