# @opencode-ai/agent-squad

A production-ready multi-agent team collaboration plugin for [OpenCode](https://opencode.ai) that spawns real subagents and executes them in parallel.

## Features

- **Real Subagent Execution**: Uses OpenCode SDK to spawn actual sessions
- **Parallel Execution**: All agents execute in parallel via `Promise.allSettled()`
- **Task Dependencies**: Full blocks/blockedBy dependency management with cycle detection
- **Devil's Advocate**: Critical thinking agent included in every team preset
- **Natural Language**: Auto-detect team preset from keywords
- **Persistence**: Team state saved to `~/.opencode/teams/`
- **26 Tools**: Complete team, task, plan, and reputation management

## Quick Start

```bash
# Install
npm install @opencode-ai/agent-squad

# Or clone
git clone https://github.com/Burgunthy/opencode-agent-squad.git ~/.config/opencode/plugins/opencode-agent-squad
cd ~/.config/opencode/plugins/opencode-agent-squad && bun install && bun run build
```

Add to opencode.json:
```json
{
  "plugin": ["./plugins/opencode-agent-squad"]
}
```

## Basic Usage

```
/team-auto "이 코드를 리뷰해줘"
```

## Installation

### Option 1: Local Plugin (Recommended)

```bash
# Clone the repository
git clone https://github.com/Burgunthy/opencode-agent-squad.git ~/.config/opencode/plugins/opencode-agent-squad

# Install dependencies and build
cd ~/.config/opencode/plugins/opencode-agent-squad
bun install && bun run build
```

### Option 2: npm

```bash
bun add @opencode-ai/agent-squad
```

## Configuration

Add to your `opencode.json`:

```json
{
  "plugin": [
    "./plugins/opencode-agent-squad"
  ]
}
```

## Available Tools (26)

### Team Management (6)
| Tool | Description |
|------|-------------|
| `team-spawn` | Create a team with preset or custom agents |
| `team-execute` | Execute all agents in parallel |
| `team-discuss` | Sequential discussion with context sharing |
| `team-status` | Check team status and results |
| `team-shutdown` | Cleanup and remove team |
| `team-auto` | Natural language team request |

### Task Management (4)
| Tool | Description |
|------|-------------|
| `task-create` | Create a task with dependencies |
| `task-update` | Update task status, owner, dependencies |
| `task-execute` | Execute tasks respecting dependencies |
| `task-list` | List all tasks in a team |

### Plan Approval (6)
| Tool | Description |
|------|-------------|
| `plan-submit` | Submit a plan for approval |
| `plan-approve` | Approve a submitted plan |
| `plan-reject` | Reject a plan with feedback |
| `plan-list` | List all plans |
| `plan-status` | Get plan details |
| `plan-resubmit` | Resubmit a rejected plan |

### Reputation & Differentiation (10)
| Tool | Description |
|------|-------------|
| `agent-reputation` | Get agent reputation info |
| `agent-score` | Score an agent (1-10) |
| `agent-scores` | Get score history |
| `agent-rankings` | Get agent rankings |
| `team-vote` | Run team voting |
| `team-score` | Score team results |
| `team-summarize` | Generate summary report |
| `agent-handoff` | Delegate tasks between agents |
| `conflict-resolve` | Structured conflict resolution |
| `da-critique` | Auto Devil's Advocate critique |

## Team Presets

| Preset | Agents |
|--------|--------|
| `review` | code-reviewer, security-auditor, devil-s-advocate |
| `security` | security-auditor, devil-s-advocate |
| `debug` | debugger, devil-s-advocate |
| `planning` | planner, devil-s-advocate |
| `implementation` | backend-developer, frontend-developer, test-automator, devil-s-advocate |
| `fullstack` | fullstack-developer, devil-s-advocate |
| `research` | explore, data-scientist, devil-s-advocate |
| `ai` | ai-engineer, llm-architect, prompt-engineer, devil-s-advocate |

## Usage Examples

### 1. Code Review

코드 리뷰를 위해 전문 에이전트 팀을 구성하고 병렬로 실행합니다.

```
/team-auto request="src/auth.ts 파일의 보안 취약점과 코드 품질을 리뷰해주세요"
```

또는 수동으로:
```
/team-spawn preset="review" teamName="auth-review" task="auth.ts 코드 리뷰"
/team-execute teamId="team-xxx"
/team-status teamId="team-xxx"
```

**실행 에이전트**: code-reviewer, security-auditor, devil's-advocate

### 2. Bug Debugging

복잡한 버그를 다양한 관점에서 분석하고 해결책을 찾습니다.

```
/team-auto request="프로덕션 환경에서만 발생하는 레이스 컨디션 버그를 디버깅해줘"
```

또는:
```
/team-spawn preset="debug" teamName="race-condition-debug" task="레이스 컨디션 분석"
/team-execute teamId="team-xxx"
```

**실행 에이전트**: debugger, devil's-advocate

### 3. Feature Implementation

새로운 기능을 계획부터 구현, 테스트까지 전체 파이프라인으로 진행합니다.

```
/task-create teamId="team-xxx" subject="사용자 인증 API 설계" description="JWT 기반 인증 시스템 설계" owner="planner"

/task-create teamId="team-xxx" subject="백엔드 API 구현" description="Express.js로 /api/auth 엔드포인트 구현" owner="backend-developer" blockedBy="task-001"

/task-create teamId="team-xxx" subject="프론트엔드 UI 구현" description="React 로그인 폼 구현" owner="frontend-developer" blockedBy="task-001"

/task-create teamId="team-xxx" subject="자동화 테스트 작성" description="인증 흐름 E2E 테스트" owner="test-automator" blockedBy="task-002,task-003"

/task-execute teamId="team-xxx"
```

**실행 에이전트**: planner, backend-developer, frontend-developer, test-automator, devil's-advocate

### 4. Security Audit

보안 취약점을 종합적으로 분석하고 보고서를 작성합니다.

```
/team-auto request="전체 애플리케이션의 OWASP Top 10 취약점을 점검해주세요"
```

또는:
```
/team-spawn preset="security" teamName="owasp-audit" task="OWASP Top 10 보안 감사"
/team-discuss teamId="team-xxx" topic="SQL Injection, XSS, CSRF 취약점 공유" rounds=3
```

**실행 에이전트**: security-auditor, devil's-advocate

### 5. Discussion & Consensus

복잡한 기술적 의사결정을 위해 토론을 진행하고 합의를 도출합니다.

```
/team-spawn preset="planning" teamName="architecture-decision" task="마이크로서비스 vs 모놀리식 아키텍처"

/team-discuss teamId="team-xxx" topic="현재 요구사항에 맞는 아키텍처 선택" rounds=4
```

여러 라운드에 걸쳐 각 에이전트가 이전 라운드의 결과를 참고하여 의견을 개진합니다.

**실행 에이전트**: planner, devil's-advocate

## FAQ

### Q1: 어떤 팀 프리셋을 사용해야 하나요?

**A:** 작업 유형에 따라 자동 감지됩니다:
- 코드 검토 → `review`
- 보안/취약점 → `security`
- 버그 수정 → `debug`
- 아키텍처/설계 → `planning`
- 신규 기능 개발 → `implementation`

`/team-auto`를 사용하면 자동으로 적절한 프리셋이 선택됩니다.

### Q2: 에이전트 간에 어떻게 통신하나요?

**A:** 두 가지 모드를 지원합니다:
- **병렬 실행 (`team-execute`)**: 모든 에이전트가 동시에 작업하고 결과를 집계
- **토론 모드 (`team-discuss`)**: 에이전트가 순차적으로 실행되며 이전 결과를 참고

### Q3: 작업 의존성은 어떻게 설정하나요?

**A:** `task-create` 도구의 `blockedBy` 파라미터를 사용하세요:
```
/task-create teamId="xxx" subject="Task B" blockedBy="task-001"
```
순환 의존성은 자동으로 감지되어 경고가 표시됩니다.

### Q4: Devil's Advocate는 무슨 역할을 하나요?

**A:** 모든 팀 프리셋에 포함된 비판적 사고 에이전트로:
- 가정을 도전
- 엣지 케이스 식별
- 대안 제시
- 다른 에이전트가 놓친 부분 발견

### Q5: 팀 상태는 어디에 저장되나요?

**A:** `~/.opencode/teams/{teamId}.json` 파일에 자동 저장됩니다. 세션 간에 상태가 유지되며 작업이 완료된 후에는 `/team-shutdown`으로 정리하는 것을 권장합니다.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Plugin Initialization                     │
│  globalClient = input.client                                 │
│  loadOpenCodeAgents()                                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      team-spawn                              │
│  1. Load agents from opencode.json                          │
│  2. Create Team object with Map<string, Agent>              │
│  3. Initialize tasks Map                                     │
│  4. Save to ~/.opencode/teams/{teamId}.json                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      team-execute                            │
│  Promise.allSettled([                                        │
│    spawnAgentSession("security-auditor", task)              │
│    spawnAgentSession("devil-s-advocate", task)              │
│    ...                                                       │
│  ])                                                          │
│                                                              │
│  Each: session.create() -> session.prompt() -> waitFor()    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Results                                │
│  - Aggregate all agent responses                            │
│  - Store in team.results Map                                │
│  - Save persisted state                                      │
│  - Return formatted output                                   │
└─────────────────────────────────────────────────────────────┘
```

## Devil's Advocate

Every team includes a Devil's Advocate agent that:

- Challenges assumptions
- Identifies edge cases
- Proposes alternatives
- Finds what others missed

The Devil's Advocate prompt is automatically injected for any agent with "devil" in the name.

## Task Dependencies

```typescript
interface Task {
  id: string;
  subject: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "blocked" | "error";
  owner?: string;
  blockedBy: string[];  // Tasks this depends on
  blocks: string[];     // Tasks that depend on this
}
```

Features:
- **Cycle Detection**: Automatically detects circular dependencies
- **Execution Order**: Tasks execute only when all dependencies are completed
- **Deadlock Prevention**: Maximum iteration limit with warning

## Comparison with Claude Code

| Feature | Claude Code | This Plugin |
|---------|-------------|-------------|
| Team Creation | TeamCreate | team-spawn |
| Parallel Execution | Promise.all | Promise.allSettled |
| Real Subagents | Task tool | session API |
| Devil's Advocate | Required | In all presets |
| Task Dependencies | blocks/blockedBy | blocks/blockedBy |
| Task Update | TaskUpdate | task-update |
| Persistence | Memory | File-based |
| Inter-agent Messaging | SendMessage | SendMessage (via message queue) |
| Plan Approval | ❌ | ✅ 6 tools |
| Reputation System | ❌ | ✅ 4 tools |
| Voting System | ❌ | ✅ team-vote |
| Korean Optimization | ❌ | ✅ Korean prompts |

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Run tests
bun test

# Run specific tests
bun test test/unit.test.ts
bun test test/integration.test.ts
```

## Testing

```bash
# Build verification
bun run build

# Manual testing
/team-auto "이 코드를 리뷰해줘"
```

> **Note**: Automated unit tests are planned for v1.1.0. The plugin is currently verified through manual testing and TypeScript strict mode compilation.

## Security

- No hardcoded secrets or API keys
- Session cleanup on shutdown
- Maximum team/task limits to prevent resource exhaustion
- Cyclic dependency detection prevents infinite loops
- All file paths are safely constructed

## Requirements

- OpenCode >= 1.1.60
- Bun runtime

## License

MIT

## Contributing

기여는 언제나 환영입니다! 다음 가이드를 따라주세요.

### 개발 환경 설정

```bash
# 1. Repository 포크 및 클론
git clone https://github.com/YOUR_USERNAME/opencode-agent-squad.git
cd opencode-agent-squad

# 2. 의존성 설치
bun install

# 3. 개발 모드로 빌드
bun run build

# 4. 테스트 실행
bun test
```

### 코드 스타일

- TypeScript 사용
- 함수형 프로그래밍 선호
- 명확한 네이밍 컨벤션
- 주석은 복잡한 로직에만 작성

### 커밋 컨벤션

```
feat: 새로운 기능 추가
fix: 버그 수정
docs: 문서 업데이트
refactor: 코드 리팩토링
test: 테스트 추가/수정
chore: 빌드/설정 관련
```

### Pull Request 프로세스

1. **변경 사항 설명**: PR 템플릿을 작성하세요
2. **테스트 확인**: 모든 테스트가 통과해야 합니다
3. **코드 리뷰**: 최소 1명의 승인 필요
4. **CI/CD**: 자동화된 체크가 통과되어야 합니다

### 새로운 에이전트 프리셋 추가

`src/presets.ts`에 새로운 프리셋을 추가하세요:

```typescript
export const PRESETS: Record<string, AgentPreset[]> = {
  'your-preset': [
    { name: 'agent-name', role: '...', instructions: '...' },
    { name: 'devil-s-advocate', role: '...', instructions: '...' }
  ]
}
```

### 이슈 보고

버그나 기능 요청은 [GitHub Issues](https://github.com/Burgunthy/opencode-agent-squad/issues)에 등록해주세요.

### 라이선스

기여하신 코드는 프로젝트의 MIT 라이선스 하에 배포됩니다.

## Credits

Inspired by Claude Code's agent-teams functionality. Built for the OpenCode ecosystem.
