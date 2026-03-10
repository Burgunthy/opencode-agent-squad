# agent-squad - Testing Guide for Report Quality

This guide helps verify if the plugin provides genuinely useful reports.

## Test Scenarios

### Test 1: Security Vulnerability Detection

**Test Code:**
```javascript
// Vulnerable authentication function
function authenticate(username, password) {
  const query = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;
  const user = db.execute(query);
  return user.length > 0;
}
```

**Command:**
```bash
/squad task="Review this code for security vulnerabilities" mode="review"
```

**Expected Useful Output Should Include:**

From `security-auditor`:
- ✅ SQL injection vulnerability identified
- ✅ Specific vulnerable line pointed out
- ✅ Attack example provided
- ✅ Fix suggestion (parameterized queries)

From `devil-s-advocate` (Second-Pass):
- ✅ Critique of the security-auditor's fix
- ✅ Additional issues: plain text passwords, no rate limiting
- ✅ Alternative approaches mentioned
- ✅ Edge cases others missed

**Quality Checklist:**
- [ ] DA references the security-auditor's specific findings
- [ ] Suggestions are actionable (not generic)
- [ ] Code examples are provided
- [ ] Severity levels are indicated

---

### Test 2: Bug Investigation

**Test Code:**
```javascript
// Intermittent bug - race condition
async function processOrder(orderId) {
  const order = await db.get('orders:' + orderId);
  if (order.status === 'pending') {
    order.status = 'processing';
    await db.set('orders:' + orderId, order);
    // ... processing logic
  }
}
```

**Command:**
```bash
/squad task="Why might this function have race conditions?" mode="thorough"
```

**Expected Useful Output Should Include:**

From `debugger`:
- ✅ Race condition between read and write
- ✅ Multiple concurrent requests can cause issues
- ✅ Suggests locking or atomic operations

From `devil-s-advocate`:
- ✅ What if the database operation fails?
- ✅ Edge case: order deleted between get and set
- ✅ Alternative: Use database transactions

---

### Test 3: Code Efficiency

**Test Code:**
```javascript
// Inefficient nested loops
function findDuplicates(arr1, arr2) {
  const duplicates = [];
  for (let i = 0; i < arr1.length; i++) {
    for (let j = 0; j < arr2.length; j++) {
      if (arr1[i] === arr2[j]) {
        duplicates.push(arr1[i]);
      }
    }
  }
  return duplicates;
}
```

**Command:**
```bash
/squad task="Is this function efficient? Can it be optimized?" mode="fast"
```

**Expected Useful Output Should Include:**

From `code-reviewer`:
- ✅ O(n*m) time complexity identified
- ✅ Suggestion to use Set for O(n+m)
- ✅ Code example of optimized version

From `devil-s-advocate`:
- ✅ What if arrays contain duplicates? Output will have duplicates
- ✅ Memory usage considerations
- ✅ Alternative: filter + includes approach

---

### Test 4: Feature Planning

**Command:**
```bash
/squad task="How should I design a real-time notification system?" mode="creative"
```

**Expected Useful Output Should Include:**

From multiple agents (planner, frontend-dev, backend-dev, ui-designer):
- ✅ Architecture options (WebSocket vs SSE vs polling)
- ✅ Database considerations for storing notifications
- ✅ UI patterns for displaying notifications
- ✅ Scalability concerns

From `devil-s-advocate`:
- ✅ What if the WebSocket server goes down?
- ✅ Battery/带宽 impact on mobile
- ✷ User notification fatigue
- ✅ Privacy considerations

---

## Quality Evaluation Criteria

### 1. **Specificity** ✅
- [ ] References specific code lines or functions
- [ ] Provides concrete examples
- [ ] Names specific technologies/libraries

### 2. **Actionability** ✅
- [ ] Suggestions can be directly implemented
- [ ] Code snippets are provided
- [ ] Steps are clear and ordered

### 3. **Depth** ✅
- [ ] Goes beyond obvious issues
- [ ] Considers edge cases
- [ ] Addresses root causes, not symptoms

### 4. **DA Value-Add** ✅
- [ ] DA references other agents' findings
- [ ] DA identifies what others missed
- [ ] DA provides alternative perspectives
- [ ] DA challenges assumptions

### 5. **Clarity** ✅
- [ ] Output is well-structured
- [ ] Technical terms are explained
- [ ] Severity/impact is clear

---

## Red Flags (Indicates Poor Quality)

🔴 **Red Flags that mean the plugin is NOT useful:**

1. **Generic Advice**
   - "Use best practices" without specifics
   - "Consider security" without examples
   - "Optimize your code" without showing how

2. **DA Doesn't Reference Others**
   - DA output is standalone critique
   - No mention of what other agents found
   - Second-pass claim is fake

3. **Obvious-Only Analysis**
   - Only points out surface-level issues
   - Misses important edge cases
   - No "what others missed" section

4. **No Code Examples**
   - Suggestions are prose-only
   - No before/after comparisons
   - Abstract recommendations only

5. **Contradictory Advice**
   - Agents give conflicting suggestions
   - No resolution or trade-off analysis

---

## How to Run These Tests

### Prerequisites
```bash
# Ensure plugin is installed
cd ~/.config/opencode/plugins/opencode-agent-squad
bun run build

# Ensure plugin is in opencode.json
opencode config get plugin | grep agent-squad
```

### Running Tests

```bash
# Test 1: Security
opencode run 'Create a file called test-vuln.js with vulnerable SQL authentication code, then use /squad to review it for security vulnerabilities'

# Test 2: Bug investigation
opencode run 'Create test-race.js with race condition code, then /squad task="Why might this have race conditions?"'

# Test 3: Efficiency
opencode run 'Create test-slow.js with nested loop duplicate finder, then /squad task="Is this efficient?"'
```

---

## Example of GOOD vs BAD Output

### ❌ BAD Output (Generic, Unhelpful)

```
### security-auditor
This code has security issues. You should use parameterized queries
and hash passwords. Also add input validation.

### devil-s-advocate
### What's Wrong
The code is vulnerable.

### Alternative Approach
Use better security practices.

### What Others Missed
Nothing specific to mention.
```

### ✅ GOOD Output (Specific, Actionable)

```
### security-auditor
**CRITICAL: SQL Injection in authenticate()**

Line 2 is vulnerable:
```javascript
const query = `SELECT * FROM users WHERE username = '${username}'`
```

**Attack**: Input `admin' OR '1'='1` bypasses authentication.

**Fix**:
```javascript
const query = 'SELECT * FROM users WHERE username = ? AND password = ?';
await db.execute(query, [username, hashedPassword]);
```

### devil-s-advocate (Second-Pass Review)
The security-auditor found SQL injection correctly, but the fix has gaps:

### What's Wrong
1. No password hashing mentioned - storing plain text passwords
2. No timing-safe comparison - vulnerable to timing attacks
3. No account lockout - brute force attacks possible

### Alternative Approach
- Use bcrypt/Argon2 for password hashing
- Add rate limiting (5 attempts per minute)
- Use `crypto.timingSafeEqual()` for comparison

### What Others Missed
- Session hijacking risk without secure cookies
- No logging of failed attempts for audit trail
- User enumeration via username field
```

---

## Conclusion

The plugin is **useful** if:
- ✅ At least 3/5 quality criteria are met
- ✅ DA consistently adds value beyond other agents
- ✅ Output saves time vs manual research

The plugin needs **improvement** if:
- ❌ Red flags appear in outputs
- ❌ DA is just "generic contrarian" without specific critique
- ❌ Advice could be found in 30 seconds of Googling
