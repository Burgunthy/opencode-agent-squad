# Changelog

All notable changes to @opencode-ai/agent-squad will be documented in this file.

## [2.1.0] - 2026-03-11

### Critical Fixes Based on Devil's Advocate Review

**Cache Improvements**
- Replaced O(n) full-scan cache with proper LRU implementation
- Cache key now includes hash of task + context (not just first 100 chars)
- Fixed: stale cache results when code changes
- Access-time based LRU eviction (not FIFO)

**Devil's Advocate Enhancement**
- DA now runs as **second-pass** after other agents complete
- DA actually sees and reviews other agents' results
- No longer "just another parallel agent" - true critical review

**Team Persistence (Real)**
- Teams now persist to `~/.opencode/agent-squad-teams.json`
- Teams survive restarts, crashes, and reloads
- `lastActivity` timestamp for LRU cleanup
- Team concept is now meaningful, not nominal

**Session Cleanup Tracking**
- Cleanup statistics tracked and reported
- Failed cleanups logged with sessionID + error + timestamp
- Last 100 failures retained for debugging

**Agent Availability Validation**
- Auto-detection now checks `opencode.json` before selecting agents
- Unavailable agents are skipped with warning
- Returns error if NO valid agents found

**Cost Guardrails**
- Warnings displayed when running 4+ agents
- Estimated cost shown for transparency

**Result Handling**
- Increased MAX_RESULT_LENGTH from 2000 → 3000 chars
- Truncation now shows warning: `[...TRUNCATED...]`
- Summary shows count of truncated results

**Other Improvements**
- MAX_CONTEXT_LENGTH for agent context sharing
- Better error messages with available team IDs
- Cleanup stats shown in execution summary

## [2.0.0] - 2026-03-11

### Major Changes

- **Simplified from 27 tools to 4 core tools**
  - Removed: task management, plan approval, reputation/scoring, voting, conflict resolution, agent handoff
  - Kept: `squad`, `team-spawn`, `team-execute`, `team-discuss`

### Performance Improvements

- **Parallel execution in /squad** - 2-3x faster (sequential → parallel)
- **Smart caching** - 5-minute TTL with 100-entry limit
- **Consistent timeouts** - Standardized to 90 seconds across all tools

### Bug Fixes

- **Fixed: Empty results bug** - /squad now properly waits for agent completion using `waitForSessionCompletion()`
- **Fixed: Memory leaks** - Sessions cleaned up in all code paths (success + error)
- **Fixed: Silent error swallowing** - Added logging for cleanup failures
- **Fixed: Double-cleanup attempts** - sessionID cleared after cleanup

### Code Quality

- **Reduced code by ~72%** - From 3000+ lines to 884 lines
- **Removed dead code** - Cleaned up unused functions and types
- **Simplified exports** - Clear 4-tool interface

### Documentation

- Added comprehensive README with real examples
- Added EXAMPLES.md with practical use cases
- Updated package.json description

### Removed Features

The following features were removed as they were either:
- Not functional (plan approval had no execution integration)
- Rarely used (reputation, voting systems)
- Added complexity without proportional value

**Removed:**
- Task Management: `task-create`, `task-execute`, `task-list`, `task-update`
- Plan Approval: `plan-submit`, `plan-approve`, `plan-reject`, `plan-list`, `plan-status`, `plan-resubmit`
- Reputation & Scoring: `agent-reputation`, `agent-score`, `agent-scores`, `agent-rankings`
- Collaboration: `team-vote`, `team-score`, `team-summarize`, `agent-handoff`, `conflict-resolve`
- Analysis: `da-critique` (functionality built into squad)
- Team Management: `team-status`, `team-shutdown`, `team-auto`

### Breaking Changes

If upgrading from v1.x:

1. **Tool count reduced** - 27 tools → 4 tools
2. **Persistent teams removed** - Teams are now in-memory only
3. **Plan approval workflow removed** - No more plan submit/approve/reject
4. **Reputation system removed** - No more agent scoring

### Migration Guide

**v1.x → v2.0:**

```bash
# Before (v1.x)
/team-auto request="Review this code"
/task-create teamId="xxx" subject="Check auth" ...
/plan-submit ...

# After (v2.0)
/squad task="Review this code"
# OR
/team-spawn preset="review" teamName="review" task="..."
/team-execute teamId="xxx"
```

### Presets Updated

| v1.x Preset | v2.0 Equivalent | Notes |
|--------------|-----------------|-------|
| `implementation` | `creative` | Expanded to 6 agents |
| `fullstack` | Removed | Use `creative` instead |
| `research` | Removed | Not commonly used |
| `ai` | Removed | Use `creative` instead |
| `debate` | Removed | Use `fast` with discussion |

## [1.0.0] - 2024-XX-XX

### Initial Release

- 27 tools for multi-agent orchestration
- Plan approval system
- Reputation and scoring
- Task dependency graphs
- Voting system
- Conflict resolution
- Devil's Advocate auto-critique
- Message passing between agents
