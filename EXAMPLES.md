# agent-squad - Real-World Examples

This file contains practical examples you can try immediately to understand how the plugin works.

## Quick Examples to Try

### 1. Quick Code Review (30 seconds)

```bash
/squad task="Is this function efficient?"
```

**What to expect**: 2 agents (code-reviewer + devil's-advocate) will analyze the code you've selected or pasted. DA runs as second-pass to review the code-reviewer's findings.

---

### 2. Security Audit (1 minute)

```bash
/squad task="Does this login function have security vulnerabilities?" mode="review"
```

**What to expect**: 3 agents (code-reviewer, security-auditor, devil-s-advocate) will thoroughly analyze for security issues. DA reviews the other agents' findings and provides critical analysis.

---

### 3. Debugging Help (1 minute)

```bash
/squad task="Why is my API returning 500 errors?" mode="thorough"
```

**What to expect**: 3 agents (code-reviewer, debugger, devil's-advocate) will investigate from code, runtime, and edge case perspectives. DA identifies what the others missed.

---

### 4. Brainstorming (2 minutes)

```bash
/squad task="How should I design a new user authentication system?" mode="creative"
```

**What to expect**: 6 agents (planner, frontend-dev, backend-dev, ui-designer, code-reviewer, devil's-advocate) will provide diverse perspectives. DA critiques the plan and finds edge cases.

---

## Full Workflow Examples

### Example 1: Reviewing a Pull Request

```bash
# Step 1: Quick automated review
/squad task="Review these changes for issues" mode="fast"

# Step 2: If issues found, create a persistent team for deeper analysis
/team-spawn preset="security,code-reviewer" teamName="pr-review" task="Security check for PR #123"
# Team is saved to disk - survives restarts!

# Step 3: Execute the team (DA runs as second-pass)
/team-execute teamId="team-xxx"

# Step 4: Discuss specific concerns
/team-discuss teamId="team-xxx" topic="Should we approve this PR?" rounds=2

# Team persists - come back later and continue discussion!
```

---

### Example 2: Investigating Production Bug

```bash
# Create a debugging team (persists to disk)
/team-spawn preset="debugger,security-auditor,code-reviewer" teamName="bug-hunt" task="Why do users get random 500 errors?"

# Run parallel analysis (DA second-pass reviews findings)
/team-execute teamId="team-xxx"

# Deep dive into the findings
/team-discuss teamId="team-xxx" topic="What's the root cause?" rounds=3

# Team is still available for follow-up analysis!
```

---

### Example 3: Architecture Decision

```bash
# Get diverse perspectives on architecture
/squad task="Should we use microservices or monolith for our new project?" mode="creative"

# Follow up with focused discussion
/squad task="What are the trade-offs between PostgreSQL and MongoDB for this use case?" mode="thorough"
```

---

## Example Outputs

### Security Review Example (v2.1 with Second-Pass DA)

**Input:**
```bash
/squad task="Review this code for SQL injection vulnerabilities"

function getUser(id) {
  const query = `SELECT * FROM users WHERE id = ${id}`;
  return db.execute(query);
}
```

**Output:**
```markdown
**Squad Execution Complete** (fast mode)
Security task detected
Agents: security-auditor, devil-s-advocate

---

### security-auditor

**CRITICAL: SQL Injection Vulnerability Found**

The code uses string interpolation to build a query, which is directly vulnerable to SQL injection:

```javascript
const query = `SELECT * FROM users WHERE id = ${id}`;
```

**Attack Example:**
- Input: `1 OR 1=1; DROP TABLE users;--`
- Result: Returns all users AND deletes the users table

**Risk Level: HIGH**

**Recommended Fix:**
```javascript
// Use parameterized query
const query = 'SELECT * FROM users WHERE id = ?';
await db.execute(query, [id]);
```

---

### devil-s-advocate (Second-Pass Review)

The security-auditor found the injection vulnerability but the fix has several gaps:

### What's Wrong
- The suggested fix is correct but incomplete
- No input validation on `id` parameter (could be non-numeric or negative)
- No ORM usage considered (would prevent entire class of bugs)
- No mention of additional protections needed

### Alternative Approach
1. **Use an ORM** (Prisma, Drizzle) - eliminates raw SQL entirely
2. **Add type coercion**: `const numericId = Number(id)` before query
3. **Add whitelist validation**: Only accept positive integers
4. **Add rate limiting**: Prevent enumeration attacks on the endpoint

### What Others Missed
- **Error handling**: What if database connection fails?
- **Logging**: Audit log of who accessed which user
- **Data minimization**: Why SELECT *? Select only needed fields

---

**Result**: 2/2 agents succeeded
All agents completed successfully.
```

**Key v2.1 Improvement**: Notice how the Devil's Advocate specifically references and critiques the security-auditor's findings. This is the second-pass behavior - DA sees what others found and provides targeted feedback.

---

## Common Patterns

### Pattern 1: Progressive Refinement

```bash
# Start quick and shallow
/squad task="Is this secure?"

# If concerned, go deeper
/squad task="Comprehensive security audit" mode="review"

# If still concerned, use persistent custom team
/team-spawn preset="security-auditor,code-reviewer" teamName="deep-sec" task="..."
/team-execute teamId="team-xxx"
# Team persists - come back anytime for follow-up analysis
```

### Pattern 2: Compare Approaches

```bash
/squad task="Compare REST vs GraphQL for this API design" mode="creative"
```

The creative mode with 6 agents will give you diverse perspectives on pros/cons of each approach. DA will critique assumptions and find edge cases.

### Pattern 3: Persistent Analysis Team

```bash
# Create a dedicated team that persists across sessions
/team-spawn preset="code-reviewer,security-auditor,devil-s-advocate" teamName="my-reviewers" task=""

# Use it anytime
/team-execute teamId="team-xxx" # Reuse the same team!

# Continue discussion days later
/team-discuss teamId="team-xxx" topic="Follow-up on previous findings"
```

---

## v2.1 New Features Examples

### Context-Aware Caching

```bash
# First request with specific code
/squad task="Review for SQL injection" context="function login(u,p) { ... }"

# Same task, different code - cache miss (correct!)
/squad task="Review for SQL injection" context="function getUser(id) { ... }"

# Same task and code - cache hit (instant response!)
/squad task="Review for SQL injection" context="function login(u,p) { ... }"
```

### Agent Availability Validation

```bash
# Requesting unavailable agents shows warning
/team-spawn preset="nonexistent-agent,code-reviewer" teamName="test" task="..."

# Output:
# ⚠️ Skipped (not in config): nonexistent-agent
# But continues with available agents
```

### Cost Warnings

```bash
# Large team triggers cost warning
/squad task="Plan a new feature" mode="creative"

# Output includes:
# ⚠️ Cost warning: Running 6 agents may cost ~$0.0180. Continue?
```

---

## Tips

1. **Be specific in your tasks** - More context = better analysis
2. **Use mode appropriately** - `fast` for quick questions, `creative` for planning
3. **Use context parameter** - Include relevant code in the cache key
4. **Teams persist** - Create once, use multiple times across sessions
5. **DA is critical** - Trust the second-pass review to find what others missed
6. **Cache is context-aware** - Different code = different cache entry

---

## Troubleshooting Examples

### Problem: "Agent not found"

```bash
# Check what agents are available
opencode config get agent

# Solution: Use only available agents in your preset
/team-spawn preset="code-reviewer,security-auditor" teamName="myteam" task="..."
```

### Problem: Empty results

```bash
# Common causes:
# 1. Agent definition missing in opencode.json
# 2. Code not selected/pasted
# 3. Task too vague

# Solution: Be specific and ensure code is in context
```

### Problem: Team not found

```bash
# List available teams
# (Teams persist in ~/.opencode/agent-squad-teams.json)

# Solution: Create the team first
/team-spawn preset="security" teamName="myteam" task="..."
# Team is saved to disk and will be available after restart
```

### Problem: High cleanup failure count

```bash
# If you see: [Cleanup: 45/50 successful, 5 failed]

# This means some sessions couldn't be cleaned up
# Check the logs for specific errors
# Usually transient - shouldn't affect functionality
```

---

## Advanced: Team Persistence

Starting with v2.1, teams are **persistent by default**:

```bash
# Create a team
/team-spawn preset="security" teamName="audit" task="..."

# Team is saved to ~/.opencode/agent-squad-teams.json
# Survives: restarts, crashes, reloads

# Use it immediately
/team-execute teamId="team-xxx"

# Or use it tomorrow (after restart)
/team-execute teamId="team-xxx"

# Or continue discussion
/team-discuss teamId="team-xxx" topic="Follow-up" rounds=2
```

**Team Storage**: `~/.opencode/agent-squad-teams.json`

**Cleanup**: Teams are removed based on `lastActivity` (LRU) when max 50 teams is reached.
