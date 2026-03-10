# @opencode-ai/agent-squad

[![npm version](https://img.shields.io/badge/version-2.1.0-blue.svg)](https://www.npmjs.com/package/@opencode-ai/agent-squad)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![opencode](https://img.shields.io/badge/OpenCode-%3E%3D1.1.60-purple.svg)](https://opencode.ai)

> A simplified multi-agent orchestration plugin for OpenCode - run multiple AI agents in parallel and get aggregated results in seconds.

## Overview

`agent-squad` lets you run multiple AI agents simultaneously and combine their perspectives. Instead of manually prompting different agents one by one, just use `/squad` and get comprehensive analysis instantly.

**Why use it?**
- **Speed**: Agents run in parallel, not sequentially
- **Balance**: Built-in Devil's Advocate prevents groupthink
- **Simplicity**: One command does it all

## Quick Start

```bash
# Install
cd ~/.config/opencode/plugins/opencode-agent-squad
bun install && bun run build

# Add to opencode.json
echo '{"plugin": ["./plugins/opencode-agent-squad"]}' >> ~/.opencode/opencode.json

# Use
/squad task="Review this code for security issues"
```

## Features

- **Parallel Execution**: All agents run simultaneously (2-3x faster than sequential)
- **Auto-Detection**: Automatically selects the right agents based on your task
- **Devil's Advocate**: Built-in critical analysis prevents confirmation bias
- **Smart Caching**: Same question within 5 minutes? Instant cached response
- **Proper Cleanup**: All sessions cleaned up, no memory leaks

## Installation

```bash
# 1. Clone the plugin
git clone https://github.com/Burgunthy/opencode-agent-squad.git ~/.config/opencode/plugins/opencode-agent-squad

# 2. Build
cd ~/.config/opencode/plugins/opencode-agent-squad
bun install
bun run build

# 3. Add to your opencode.json
opencode config set plugin ./plugins/opencode-agent-squad
```

## Tools

### 1. `/squad` - All-in-One Command (Recommended)

Automatically detects the best agents and runs them in parallel. **DA runs as second-pass to review results.**

```bash
# Basic usage
/squad task="Analyze this function for bugs"

# With mode
/squad task="Review auth module" mode="review"

# With context (included in cache key)
/squad task="Review this code" context="function login() { ... }"

# No cache
/squad task="Fresh analysis" useCache=false
```

#### Modes

| Mode | Agents | Speed | Best For |
|------|--------|-------|----------|
| `fast` | 2 | ⚡⚡⚡ | Quick questions, simple reviews |
| `thorough` | 3 | ⚡⚡ | Detailed analysis, complex issues |
| `review` | 3 | ⚡⚡ | Code review with security focus |
| `creative` | 6 | ⚡ | Brainstorming, feature planning |

#### Example Output

```bash
You: /squad task="Is this login function secure?"

**Squad Execution Complete** (fast mode)
Security task detected
Agents: security-auditor, devil-s-advocate

---

### security-auditor

The login function has several security issues:

1. **Plain text password**: Password is compared directly without hashing
2. **No rate limiting**: Brute force attacks possible
3. **Error leakage**: Different messages for invalid user vs invalid password
4. **No session timeout**: Sessions never expire

Recommendation: Use bcrypt, add rate limiting, use generic error messages.

---

### devil-s-advocate (Second-Pass Review)

The security-auditor covered the basics but missed critical issues:

### What's Wrong
- No protection against timing attacks
- Missing account lockout after failed attempts
- No multi-factor authentication option
- Password reset flow not mentioned

### Alternative Approach
- Use Argon2 or bcrypt with proper salt
- Implement exponential backoff for failed attempts
- Add TOTP support for 2FA
- Use security questions only as secondary verification

### What Others Missed
- Session fixation attacks
- Password complexity requirements not enforced
- No CSRF protection if used in web context

---

**Result**: 2/2 agents succeeded
All agents completed successfully.
```

**Note**: The Devil's Advocate now runs as a second-pass, reviewing the security-auditor's actual output and providing specific critique.

### 2. `/team-spawn` - Create Persistent Team

Create a team with specific agents. **Teams persist to disk and survive restarts.**

```bash
# Using preset
/team-spawn preset="security" teamName="audit-team" task="Review for SQL injection"

# Custom agents
/team-spawn preset="code-reviewer,security-auditor,devil-s-advocate" teamName="review" task="Check this PR"
```

#### Output Example

```bash
## Team "audit-team" Created

**Team ID**: team-1234567890
**Preset**: security
**Agents**: 2
**Persistence**: Team saved to disk, survives restarts

### Agents
- **security-auditor** (Security Auditor) [OK]
- **devil-s-advocate** (Devil's Advocate) [OK]

### Task
Review for SQL injection

---
Use `/team-execute teamId="team-1234567890"` to run.
```

### 3. `/team-execute` - Run Team (DA as Second-Pass)

Execute all agents in parallel. **Devil's Advocate runs as second-pass to review others' results.**

```bash
/team-execute teamId="team-1234567890"
```

#### Output Example

```bash
## Executing Team "audit-team"

**Task**: Review for SQL injection
**Agents**: 2
**Mode**: Parallel execution, DA reviews as second-pass

---

**Phase 1: Initial Analysis**

---

### security-auditor

Found potential SQL injection in userQuery function:

```javascript
// Vulnerable code at line 45
const query = `SELECT * FROM users WHERE name = '${userName}'`;
```

Risk: Attacker can inject malicious SQL via userName parameter.

Fix: Use parameterized queries:
```javascript
const query = 'SELECT * FROM users WHERE name = ?';
```

---

**Phase 2: Devil's Advocate Review**

### devil-sadvocate

The security-auditor found the issue but the fix has gaps:

### What's Wrong
- The fix is correct but incomplete
- No input sanitization before the query
- Prepared statements help but don't protect all injection vectors
- No mention of ORM usage as alternative

### Alternative Approach
- Consider using an ORM (Prisma, Drizzle) with built-in protection
- Add whitelist validation for column names if dynamic queries are needed
- Implement query result row limiting to prevent data exfiltration

---

**Result**: 2/2 agents succeeded
All agents completed successfully.

**Team ID**: team-1234567890
**Team persists**: Use `/team-discuss teamId="team-1234567890"` to continue discussion.
```

### 4. `/team-discuss` - Multi-Round Discussion

Agents discuss sequentially, each seeing previous agents' results.

```bash
/team-discuss teamId="team-1234567890" topic="Best way to fix SQL injection" rounds=2
```

#### Output Example

```bash
## Discussion: Best way to fix SQL injection

**Team**: audit-team
**Rounds**: 2

### Round 1

**security-auditor**:
Use parameterized queries with prepared statements. This is the industry standard and most reliable approach.

**devil-s-advocate**:
Prepared statements help but don't solve everything. You still need input validation and output encoding. OWASP ESAPI is recommended.

---

### Round 2

**security-auditor**:
Good point about ESAPI. For this specific case, I'd also recommend:
- Whitelist validation for userName (alphanumeric only)
- Limit query results with LIMIT clause
- Add query monitoring for anomaly detection

**devil-savocate**:
Don't forget:
- Database user with least privileges
- Regular security audits
- Penetration testing before deployment

---

**Team ID**: team-1234567890
```

## Presets Reference

| Preset | Agents | When to Use |
|--------|--------|-------------|
| `fast` | code-reviewer, devil-s-advocate | Quick code checks |
| `thorough` | code-reviewer, security-auditor, devil-s-advocate | Comprehensive review |
| `review` | code-reviewer, security-auditor, devil-s-advocate | PR reviews, security audits |
| `creative` | planner, fullstack-developer, frontend-developer, backend-developer, ui-designer, devil-s-advocate | Feature planning, design reviews |
| `security` | security-auditor, devil-s-advocate | Security audits, vulnerability scans |
| `debug` | debugger, devil-s-advocate | Bug investigation, error analysis |
| `plan` | planner, devil-sadvocate | Architecture decisions, planning |

## Real-World Examples

### Example 1: Security Audit

```bash
/squad task="Review this authentication code for security vulnerabilities" mode="review"
```

**What happens:**
1. Auto-detects security task → uses `review` preset
2. Runs 3 agents in parallel: code-reviewer, security-auditor, devil-s-advocate
3. Each agent analyzes the code independently
4. Results aggregated and presented together

### Example 2: Debugging Complex Issue

```bash
/squad task="Why does the payment flow fail intermittently?" mode="thorough"
```

**What happens:**
1. Uses `thorough` preset with 3 agents
2. Each agent investigates from different angle:
   - code-reviewer: Code logic issues
   - debugger: Runtime behavior analysis
   - devil-s-advocate: Edge cases you might have missed

### Example 3: Feature Planning

```bash
/squad task="Design a new user onboarding flow" mode="creative"
```

**What happens:**
1. Uses `creative` preset with 6 agents
2. Planner sets overall structure
3. Frontend/backend devs plan implementation
4. UI designer suggests user experience
5. Devil's Advocate critiques the plan

### Example 4: Manual Workflow for Deep Analysis

```bash
# Step 1: Create specialized team
/team-spawn preset="debugger,security-auditor,code-reviewer" teamName="deep-dive" task="Investigate production issue"

# Step 2: Execute parallel analysis
/team-execute teamId="team-xxx"

# Step 3: Discuss findings with multiple rounds
/team-discuss teamId="team-xxx" topic="Root cause analysis" rounds=3
```

## Tips & Best Practices

### When to Use Each Mode

```bash
# Quick questions during development
/squad task="Is this function efficient?"

# PR reviews - quick but thorough
/squad task="Review #123" mode="fast"

# Security reviews - always be thorough
/squad task="Check auth module" mode="review"

# Complex bugs - need deep analysis
/squad task="Payment fails intermittently" mode="thorough"

# Brainstorming - get diverse perspectives
/squad task="How should we redesign the API?" mode="creative"
```

### Custom Agent Combinations

```bash
# Security-focused review
/team-spawn preset="security-auditor,code-reviewer,devil-s-advocate" teamName="sec-review" task="..."

# Performance analysis
/team-spawn preset="planner,debugger" teamName="perf" task="..."

# Frontend review
/team-spawn preset="frontend-developer,ui-designer" teamName="ui" task="..."
```

### Troubleshooting

**Issue**: "Team not found" error
```bash
# Solution: List persistent teams or create a new one
# Teams persist in ~/.opencode/agent-squad-teams.json

# Check available teams (teams persist across restarts)
cat ~/.opencode/agent-squad-teams.json | grep '"id"'

# Or create a new team
/team-spawn preset="security" teamName="my-team" task="..."
```

**Issue**: Empty results
```bash
# Possible causes:
# 1. Agent not defined in opencode.json
# 2. Network timeout
# 3. Task too vague

# Solution: Check opencode.json has required agents
opencode config get agent
```

**Issue: "Agent squad" not responding
```bash
# Check plugin is loaded
opencode config get plugin

# Rebuild if needed
cd ~/.config/opencode/plugins/opencode-agent-squad
bun run build
```

## What's New in v2.1

- **🔄 Real Team Persistence**: Teams saved to disk, survive restarts
- **🎯 DA as Second-Pass**: Devil's Advocate now actually reviews other agents' results
- **💾 Proper LRU Cache**: Replaced O(n) scan with efficient LRU implementation
- **🔍 Context-Aware Cache**: Cache key includes task + context hash
- **✅ Agent Validation**: Checks availability before execution
- **💰 Cost Warnings**: Alerts for large team executions
- **📊 Cleanup Tracking**: Statistics and failure logging
- **⚠️ Truncation Warnings**: No more silent data loss

## What's New in v2.0

- **🚀 72% smaller code**: From 3000+ lines to 884 lines
- **⚡ 2-3x faster**: Parallel execution instead of sequential
- **✅ Fixed memory leaks**: Sessions properly cleaned up in all paths
- **🔧 Fixed bugs**: `/squad` now waits for completion (no empty results)
- **🧹 Simplified**: 4 focused tools instead of 27 confusing ones
- **📝 Better documentation**: Clear examples and expected outputs

## Requirements

- OpenCode >= 1.1.60
- Bun runtime

## License

MIT

## Credits

Built for the [OpenCode](https://opencode.ai) ecosystem.
