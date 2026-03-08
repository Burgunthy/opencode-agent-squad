# @opencode-ai/agent-squad

[![npm version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://www.npmjs.com/package/@opencode-ai/agent-squad)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![opencode](https://img.shields.io/badge/OpenCode-%3E%3D1.1.60-purple.svg)](https://opencode.ai)

A multi-agent orchestration plugin for [OpenCode](https://opencode.ai) that spawns multiple AI agent sessions in parallel, aggregates results, and enables structured collaboration workflows.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  Your Task: "Review this authentication module for issues"  │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
     ┌─────────┐         ┌─────────┐         ┌─────────┐
     │ Agent 1 │         │ Agent 2 │         │ Agent 3 │
     │  Code   │         │ Security│         │ Devil's │
     │ Reviewer│         │ Auditor │         │ Advocate│
     └─────────┘         └─────────┘         └─────────┘
          │                   │                   │
          └───────────────────┼───────────────────┘
                              ▼
          ┌─────────────────────────────────────────┐
          │  Aggregated Results + Cross-Analysis    │
          └─────────────────────────────────────────┘
```

Each agent runs in a separate OpenCode session with its own system prompt and context. Results are collected and can be shared between agents in subsequent rounds.

## Features

- **Parallel Execution**: Run multiple agents simultaneously
- **Context Sharing**: Agents can see each other's results in discussion mode
- **Devil's Advocate**: Built-in critical analysis for every workflow
- **Task Dependencies**: Create task graphs with `blockedBy`/`blocks` relationships
- **Plan Approval**: Submit plans for review before execution
- **Reputation System**: Track agent performance over time
- **9 Built-in Presets**: Pre-configured agent combinations for common tasks

## Installation

```bash
# Clone the repository
git clone https://github.com/Burgunthy/opencode-agent-squad.git ~/.config/opencode/plugins/opencode-agent-squad

# Install and build
cd ~/.config/opencode/plugins/opencode-agent-squad
bun install && bun run build
```

Add to your `opencode.json`:

```json
{
  "plugin": ["./plugins/opencode-agent-squad"]
}
```

## Quick Start

```bash
# Simplest usage - auto-detect preset and run
/squad task="Review src/auth.ts for security vulnerabilities"

# With explicit mode
/squad task="Debug the payment flow" mode="thorough"
```

## Core Tools

### `/squad` (Recommended)

All-in-one command that auto-detects the appropriate preset and executes parallel analysis:

```bash
/squad task="Analyze this code for bugs"
/squad task="Security audit of auth module" mode="thorough"
```

**Modes:**
| Mode | Agents | Description |
|------|--------|-------------|
| `fast` | 2 | Quick analysis |
| `thorough` | 3 | In-depth review |
| `review` | 3 | Code + security + critique |
| `creative` | 6 | Brainstorming with diverse perspectives |

### Team Management

```bash
# Create a team
/team-spawn preset="security" teamName="audit-team" task="Check for SQL injection"

# Execute in parallel
/team-execute teamId="team-xxx"

# Check status
/team-status teamId="team-xxx"

# Cleanup
/team-shutdown teamId="team-xxx"
```

### Discussion Mode

Sequential execution where each agent sees previous results:

```bash
/team-discuss teamId="team-xxx" topic="Best approach for caching" rounds=2
```

## Available Presets

| Preset | Agents | Best For |
|--------|--------|----------|
| `review` | code-reviewer, security-auditor, devil-s-advocate | Code review |
| `security` | security-auditor, devil-s-advocate | Security analysis |
| `debug` | debugger, devil-s-advocate | Bug investigation |
| `planning` | planner, devil-s-advocate | Architecture decisions |
| `implementation` | backend-dev, frontend-dev, test-automator, devil-s-advocate | Feature development |
| `fullstack` | fullstack-developer, devil-s-advocate | Full-stack tasks |
| `research` | explore, data-scientist, devil-s-advocate | Research tasks |
| `ai` | ai-engineer, llm-architect, prompt-engineer, devil-s-advocate | AI/ML work |
| `debate` | planner, devil-s-advocate, security-auditor | Technical debates |

## All Tools (27)

### Team Management (6)
| Tool | Description |
|------|-------------|
| `team-spawn` | Create a new team with specified agents |
| `team-execute` | Run all agents in parallel |
| `team-discuss` | Sequential discussion with context sharing |
| `team-status` | Check team progress and results |
| `team-shutdown` | Cleanup team and sessions |
| `team-auto` | Natural language team request with auto preset detection |

### Task Management (4)
| Tool | Description |
|------|-------------|
| `task-create` | Create a task with optional dependencies |
| `task-execute` | Execute tasks respecting dependencies |
| `task-list` | List all tasks in a team |
| `task-update` | Update task status, owner, or dependencies |

### Plan Approval (6)
| Tool | Description |
|------|-------------|
| `plan-submit` | Submit a plan for leader approval |
| `plan-approve` | Approve a submitted plan |
| `plan-reject` | Reject a plan with feedback |
| `plan-list` | List all plans |
| `plan-status` | Get detailed plan status |
| `plan-resubmit` | Resubmit a rejected plan |

### Reputation & Scoring (4)
| Tool | Description |
|------|-------------|
| `agent-reputation` | Get agent's reputation metrics |
| `agent-score` | Score an agent's performance |
| `agent-scores` | Get all scores for an agent |
| `agent-rankings` | Get agent leaderboard |

### Collaboration (5)
| Tool | Description |
|------|-------------|
| `team-vote` | Conduct team voting |
| `team-score` | Score team performance |
| `team-summarize` | Summarize team results |
| `agent-handoff` | Delegate task to another agent |
| `conflict-resolve` | Resolve conflicting agent outputs |

### Analysis (2)
| Tool | Description |
|------|-------------|
| `da-critique` | Request Devil's Advocate critique |
| `squad` | All-in-one analysis command |

## Configuration

Define agents in your `opencode.json`:

```json
{
  "agent": {
    "code-reviewer": {
      "description": "Reviews code quality, readability, and best practices",
      "prompt_append": "Focus on code quality, readability, and best practices."
    },
    "security-auditor": {
      "description": "Security vulnerability analysis",
      "prompt_append": "Focus on security vulnerabilities and risks."
    },
    "devil-s-advocate": {
      "description": "Critical analysis and edge case discovery",
      "prompt_append": "Challenge assumptions and find edge cases."
    }
  }
}
```

## Example Workflow

```bash
# 1. Create a security review team
/team-spawn preset="security" teamName="auth-review" task="Review src/auth/ for vulnerabilities"

# 2. Execute parallel analysis
/team-execute teamId="team-xxx"

# 3. Run discussion round for deeper analysis
/team-discuss teamId="team-xxx" topic="Top 3 vulnerabilities to fix first" rounds=2

# 4. Check final status
/team-status teamId="team-xxx"

# 5. Cleanup
/team-shutdown teamId="team-xxx"
```

## Architecture Notes

- **Session Isolation**: Each agent runs in its own OpenCode session
- **Message Protocol**: Results are broadcast via a message queue system
- **Persistence**: Team state, tasks, and reputations are persisted to `~/.opencode/teams/`
- **Devil's Advocate**: Automatically injects critical analysis prompts for balanced output

## Development

```bash
bun install
bun run build
bun test
```

## Requirements

- OpenCode >= 1.1.60
- Bun runtime

## License

MIT

## Credits

Built for the [OpenCode](https://opencode.ai) ecosystem. Inspired by multi-agent orchestration patterns in AI systems.
