#!/bin/bash
# Validation script for agent-squad v2.1.0
# Tests key improvements based on Devil's Advocate feedback

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0

# Helper function
run_check() {
  local description="$1"
  local command="$2"

  if eval "$command" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} $description"
    ((PASSED++))
    return 0
  else
    echo -e "${RED}✗${NC} $description"
    ((FAILED++))
    return 1
  fi
}

echo "=================================="
echo "agent-squad v2.1.0 Validation"
echo "=================================="
echo

# Test 1: Build
echo "1. Build Check"
run_check "TypeScript compilation" "bun run build"
echo

# Test 2: Dist files
echo "2. Distribution Files"
run_check "dist/index.js exists" "[ -f dist/index.js ]"
run_check "dist/index.d.ts exists" "[ -f dist/index.d.ts ]"
echo

# Test 3: LRU Cache
echo "3. LRU Cache Implementation"
run_check "SquadCache class" "grep -q 'class SquadCache' src/index.ts"
run_check "LRU access-time tracking" "grep -q 'lastAccess' src/index.ts"
run_check "Cache key generation" "grep -q 'generateKey' src/index.ts"
run_check "TTL-based expiration" "grep -q 'this.ttl' src/index.ts"
echo

# Test 4: Team Persistence
echo "4. Team Persistence"
run_check "Persistence file path" "grep -q 'agent-squad-teams.json' src/index.ts"
run_check "Load persisted teams" "grep -q 'loadPersistedTeams' src/index.ts"
run_check "Save persisted teams" "grep -q 'savePersistedTeams' src/index.ts"
run_check "lastActivity timestamp" "grep -q 'lastActivity' src/index.ts"
echo

# Test 5: Devil's Advocate Second-Pass
echo "5. DA Second-Pass"
run_check "DA second-pass function" "grep -q 'runDevilsAdvocateSecondPass' src/index.ts"
run_check "DA reviews others' results" "grep -q 'Other Agents.*Analysis' src/index.ts"
run_check "Phase 1 output" "grep -q 'Phase 1: Initial Analysis' src/index.ts"
run_check "Phase 2 output" "grep -q 'Phase 2: Devil' src/index.ts"
echo

# Test 6: Agent Validation
echo "6. Agent Availability Validation"
run_check "Validation function" "grep -q 'validateAgentAvailability' src/index.ts"
run_check "Skipped agent message" "grep -q 'Skipped.*not in config' src/index.ts"
echo

# Test 7: Cleanup Tracking
echo "7. Session Cleanup Tracking"
run_check "Cleanup stats object" "grep -q 'cleanupStats' src/index.ts"
run_check "Failure history array" "grep -q 'failures:' src/index.ts"
run_check "Cleanup in output" "grep -q 'Cleanup:.*successful' src/index.ts"
echo

# Test 8: Truncation Handling
echo "8. Truncation Warnings"
run_check "Truncation marker" "grep -q 'TRUNCATED' src/index.ts"
run_check "Truncation flag" "grep -q 'wasTruncated' src/index.ts"
run_check "Increased MAX_RESULT_LENGTH" "grep -q 'MAX_RESULT_LENGTH.*3000' src/index.ts"
echo

# Test 9: Cost Warnings
echo "9. Cost Guardrails"
run_check "Cost estimation" "grep -q 'estimateAgentCost' src/index.ts"
run_check "Cost warning message" "grep -q 'Cost warning' src/index.ts"
echo

# Test 10: Core Tools
echo "10. Core Tools Exported"
run_check "squad tool" "grep -q 'squadTool' src/index.ts"
run_check "team-spawn tool" "grep -q 'teamSpawnTool' src/index.ts"
run_check "team-execute tool" "grep -q 'teamExecuteTool' src/index.ts"
run_check "team-discuss tool" "grep -q 'teamDiscussTool' src/index.ts"
echo

# Test 11: Documentation
echo "11. Documentation"
run_check "README.md exists" "[ -f README.md ]"
run_check "CHANGELOG.md exists" "[ -f CHANGELOG.md ]"
run_check "EXAMPLES.md exists" "[ -f EXAMPLES.md ]"
run_check "TESTING_GUIDE.md exists" "[ -f TESTING_GUIDE.md ]"
run_check "README has v2.1.0" "grep -q '2.1.0' README.md"
run_check "README explains second-pass" "grep -q 'second-pass' README.md"
run_check "README explains persistence" "grep -q 'persist.*disk' README.md"
echo

# Test 12: Tests
echo "12. Test Suite"
run_check "All tests pass" "bun test"
echo

# Summary
echo "=================================="
echo "Validation Complete"
echo "=================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
if [ $FAILED -gt 0 ]; then
  echo -e "${RED}Failed: $FAILED${NC}"
fi
echo

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ All checks passed!${NC}"
  echo
  echo "To test report quality:"
  echo "  1. Install: opencode config set plugin ./plugins/opencode-agent-squad"
  echo "  2. Test: /squad task=\"Review this code\""
  echo "  3. See TESTING_GUIDE.md for quality criteria"
  exit 0
else
  echo -e "${RED}✗ Some checks failed${NC}"
  exit 1
fi
