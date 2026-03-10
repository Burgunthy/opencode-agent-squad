import { tool, type PluginInput, type Hooks } from "@opencode-ai/plugin";
import type { OpencodeClient, Part } from "@opencode-ai/sdk";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { createHash } from "crypto";

const z = tool.schema;

// ============================================================================
// TYPES
// ============================================================================

type AgentStatus = "idle" | "thinking" | "responding" | "completed" | "error";

interface Agent {
  name: string;
  sessionID: string | null;
  role: string;
  status: AgentStatus;
  result?: string;
  resultTruncated?: boolean;
  error?: string;
}

interface Team {
  id: string;
  name: string;
  preset: string;
  agents: Map<string, Agent>;
  createdAt: Date;
  task: string;
  lastActivity: Date;
}

interface OpenCodeAgent {
  description: string;
  model?: string;
  prompt_append?: string;
  tools?: Record<string, boolean>;
}

interface ExecutionResult {
  name: string;
  success: boolean;
  result?: string;
  error?: string;
  truncated?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_TEAMS = 50;
const DEFAULT_TIMEOUT_MS = 90000;
const POLL_INTERVAL_MS = 1500;
const MAX_RESULT_LENGTH = 3000;
const MAX_DISCUSSION_RESULT_LENGTH = 1500;
const DEFAULT_PRESET = "review";
const DEFAULT_TIMEOUT_SECONDS = 90;

// ============================================================================
// UX HELPERS
// ============================================================================

// Box drawing characters for pretty output
const BOX = {
  TL: "┌", TR: "┐", BL: "└", BR: "┘",
  H: "─", V: "│",
  X: "┼", XT: "┬", XB: "┴", XL: "├", XR: "┤"
};

function formatBox(title: string, content: string, width: number = 60): string {
  const titleCentered = title.padStart(Math.floor((width - title.length) / 2) + title.length).padEnd(width);
  const lines = content.split("\n");

  let output = `${BOX.TL}${BOX.H.repeat(width)}${BOX.TR}\n`;
  output += `${BOX.V}${titleCentered}${BOX.V}\n`;
  output += `${BOX.X}${BOX.H.repeat(width)}${BOX.XT}\n`;

  for (const line of lines) {
    const padded = line.padEnd(width - 2);
    output += `${BOX.V} ${padded}${BOX.V}\n`;
  }

  output += `${BOX.BL}${BOX.H.repeat(width)}${BOX.BR}\n`;
  return output;
}

function formatSection(title: string): string {
  return `\n${"=".repeat(60)}\n${title}\n${"=".repeat(60)}\n`;
}

function formatAgentHeader(name: string, status: "success" | "error" | "warning"): string {
  const icons = { success: "✅", error: "❌", warning: "⚠️" };
  return `\n${icons[status]} **${name}**\n`;
}

// ============================================================================
// CACHE IMPLEMENTATION - Proper LRU with TTL
// ============================================================================

interface CacheEntry {
  result: string;
  timestamp: number;
  accessCount: number;
  lastAccess: number;
}

class SquadCache {
  private cache: Map<string, CacheEntry>;
  private ttl: number;
  private maxSize: number;

  constructor(ttl: number = 5 * 60 * 1000, maxSize: number = 100) {
    this.cache = new Map();
    this.ttl = ttl;
    this.maxSize = maxSize;
  }

  private generateKey(mode: string, task: string, context?: string): string {
    const taskHash = createHash("md5").update(task).digest("hex").slice(0, 8);
    const contextHash = context
      ? createHash("md5").update(context).digest("hex").slice(0, 8)
      : "none";
    return `${mode}:${taskHash}:${contextHash}`;
  }

  get(mode: string, task: string, context?: string): string | null {
    const key = this.generateKey(mode, task, context);
    const entry = this.cache.get(key);

    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    entry.accessCount++;
    entry.lastAccess = now;
    return entry.result;
  }

  set(mode: string, task: string, result: string, context?: string): void {
    this.cleanExpired();

    if (this.cache.size >= this.maxSize) {
      let lruKey: string | null = null;
      let oldestAccess = Infinity;

      for (const [key, entry] of this.cache) {
        if (entry.lastAccess < oldestAccess) {
          oldestAccess = entry.lastAccess;
          lruKey = key;
        }
      }

      if (lruKey) {
        this.cache.delete(lruKey);
      }
    }

    const key = this.generateKey(mode, task, context);
    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      accessCount: 0,
      lastAccess: Date.now(),
    });
  }

  private cleanExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// ============================================================================
// SESSION CLEANUP TRACKER
// ============================================================================

interface CleanupStats {
  totalAttempts: number;
  successful: number;
  failed: number;
  failures: Array<{ sessionID: string; error: string; timestamp: number }>;
}

const cleanupStats: CleanupStats = {
  totalAttempts: 0,
  successful: 0,
  failed: 0,
  failures: [],
};

// ============================================================================
// DEVIL'S ADVOCATE - Second-Pass Implementation
// ============================================================================

const DEVILS_ADVOCATE_PROMPT = `
You are the Devil's Advocate. **You MUST provide a critical perspective on the analyses below.**

## Your Duties
1. **Identify Potential Risks**: Point out dangers in every proposal
2. **Propose Alternatives**: Suggest better approaches if available
3. **Challenge Unverified Assumptions**: Find unproven premises
4. **Discover Edge Cases**: Find scenarios other agents missed

## Output Format
### What's Wrong
- [Problem identified]

### Alternative Approach
- [Better approach if any]

### What Others Missed
- [Edge cases, exceptions, overlooked factors]

You MUST be critical. Unconditional approval is forbidden.
`;

const DEVILS_ADVOCATE_NAMES = [
  "devil-s-advocate",
  "devils-advocate",
  "devil_advocate",
  "devilsadvocate",
  "devil-sadvocate",
];

function isDevilsAdvocate(agentName: string): boolean {
  const normalized = agentName.toLowerCase().replace(/[_-]/g, "");
  return DEVILS_ADVOCATE_NAMES.some(
    name => normalized === name.replace(/[_-]/g, "")
  );
}

// ============================================================================
// TEAM PERSISTENCE
// ============================================================================

const TEAMS_PERSIST_FILE = path.join(
  process.env.HOME || "~",
  ".opencode",
  "agent-squad-teams.json"
);

function loadPersistedTeams(): Map<string, Team> {
  try {
    if (fs.existsSync(TEAMS_PERSIST_FILE)) {
      const data = fs.readFileSync(TEAMS_PERSIST_FILE, "utf-8");
      const rawTeams = JSON.parse(data);

      const teams = new Map<string, Team>();
      for (const [id, raw] of Object.entries(rawTeams)) {
        const team = raw as any;
        team.agents = new Map(Object.entries(team.agents));
        team.createdAt = new Date(team.createdAt);
        team.lastActivity = new Date(team.lastActivity || team.createdAt);
        teams.set(id, team);
      }

      console.log(`[agent-squad] Loaded ${teams.size} persisted teams`);
      return teams;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[agent-squad] Failed to load persisted teams: ${errorMessage}`);
  }
  return new Map();
}

function savePersistedTeams(teams: Map<string, Team>): void {
  try {
    const dir = path.dirname(TEAMS_PERSIST_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const rawTeams: Record<string, any> = {};
    for (const [id, team] of teams) {
      rawTeams[id] = {
        ...team,
        agents: Object.fromEntries(team.agents),
        createdAt: team.createdAt.toISOString(),
        lastActivity: team.lastActivity.toISOString(),
      };
    }

    fs.writeFileSync(TEAMS_PERSIST_FILE, JSON.stringify(rawTeams, null, 2));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[agent-squad] Failed to persist teams: ${errorMessage}`);
  }
}

// ============================================================================
// GLOBAL STATE
// ============================================================================

let globalClient: OpencodeClient | null = null;
let opencodeConfig: Record<string, OpenCodeAgent> = {};
const teams = loadPersistedTeams();
const squadCache = new SquadCache(5 * 60 * 1000, 100);

// ============================================================================
// PRESETS
// ============================================================================

const PRESETS: Record<string, string[]> = {
  fast: ["code-reviewer", "devil-s-advocate"],
  thorough: ["code-reviewer", "security-auditor", "devil-s-advocate"],
  creative: ["planner", "fullstack-developer", "frontend-developer", "backend-developer", "ui-designer", "devil-s-advocate"],
  review: ["code-reviewer", "security-auditor", "devil-s-advocate"],
  security: ["security-auditor", "devil-s-advocate"],
  debug: ["debugger", "devil-s-advocate"],
  plan: ["planner", "devil-s-advocate"],
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function truncateText(text: string, maxLength: number): { text: string; wasTruncated: boolean } {
  if (text.length <= maxLength) {
    return { text, wasTruncated: false };
  }
  return { text: text.slice(0, maxLength - 12) + "\n\n[...TRUNCATED...]", wasTruncated: true };
}

function loadOpenCodeAgents(): Record<string, OpenCodeAgent> {
  try {
    const configPath = path.join(process.cwd(), "opencode.json");
    const configContent = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(configContent);
    return config.agent ?? {};
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[agent-squad] Failed to load opencode.json: ${errorMessage}`);
    return {};
  }
}

function extractRoleFromDescription(description: string | undefined, agentName: string): string {
  if (!description) return agentName;
  const match = description.match(/^You are (?:a|an) ([^.]+)\./i);
  return match ? match[1] : agentName;
}

function validateAgentAvailability(agentNames: string[]): {
  valid: string[];
  invalid: string[];
} {
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const name of agentNames) {
    if (opencodeConfig[name]) {
      valid.push(name);
    } else {
      invalid.push(name);
    }
  }

  return { valid, invalid };
}

function estimateAgentCost(agentCount: number): string {
  if (agentCount >= 4) {
    return `💰 *Cost estimate*: Running ${agentCount} agents (~${(agentCount * 0.003).toFixed(4)} USD)`;
  }
  return "";
}

function getSuggestedAgents(mode: string): string {
  const available = Object.keys(opencodeConfig);
  if (available.length === 0) return "No agents configured in opencode.json";

  // Find best matching preset based on available agents
  for (const [presetName, agents] of Object.entries(PRESETS)) {
    const valid = agents.filter(a => available.includes(a));
    if (valid.length >= 2) {
      return `Try: /squad task="your task" mode="${presetName}"`;
    }
  }

  // Fallback: suggest first 2 available agents
  if (available.length >= 2) {
    return `Try: /team-spawn preset="${available.slice(0, 2).join(",")}" teamName="myteam" task="your task"`;
  }

  return "Configure agents in opencode.json first";
}

// ============================================================================
// REAL AGENT EXECUTION
// ============================================================================

async function spawnAgentSession(
  agentName: string,
  task: string,
  teamId?: string
): Promise<{ sessionID: string; agent: OpenCodeAgent | undefined }> {
  if (!globalClient) {
    throw new Error("OpenCode client not initialized");
  }

  const sessionResponse = await globalClient.session.create({});
  const sessionID = sessionResponse.data?.id;

  if (!sessionID) {
    throw new Error("Failed to create session: no session ID returned");
  }

  const agentConfig = opencodeConfig[agentName];

  const isDA = isDevilsAdvocate(agentName);
  const basePrompt = agentConfig?.prompt_append || "";

  const effectiveSystemPrompt = isDA
    ? basePrompt + "\n\n" + DEVILS_ADVOCATE_PROMPT
    : basePrompt;

  let fullTask = task;
  if (teamId && !isDA) {
    const agentContext = formatAgentContext(teamId, agentName);
    if (agentContext && !agentContext.includes("No results yet")) {
      fullTask = `${task}\n\n## Other Team Members' Results:\n${agentContext}\n\nConsider this information when performing your task.`;
    }
  }

  const promptBody: {
    parts: Array<{ type: "text"; text: string }>;
    agent: string;
    system?: string;
    model?: { providerID: string; modelID: string };
  } = {
    parts: [{ type: "text" as const, text: fullTask }],
    agent: agentName,
  };

  if (effectiveSystemPrompt) {
    promptBody.system = effectiveSystemPrompt;
  }

  if (agentConfig?.model) {
    const parts = agentConfig.model.split("/");
    if (parts.length >= 2) {
      promptBody.model = { providerID: parts[0], modelID: parts.slice(1).join("/") };
    } else {
      console.warn(`[agent-squad] Invalid model format "${agentConfig.model}", expected "provider/model"`);
    }
  }

  await globalClient.session.prompt({
    path: { id: sessionID },
    body: promptBody,
  });

  return { sessionID, agent: agentConfig };
}

async function waitForSessionCompletion(
  sessionID: string,
  timeout: number = DEFAULT_TIMEOUT_MS
): Promise<string> {
  const startTime = Date.now();
  let lastError: Error | null = null;
  let consecutiveErrors = 0;

  const isTextPart = (p: Part): p is Part & { type: "text"; text: string } =>
    p.type === "text" && "text" in p;

  while (Date.now() - startTime < timeout) {
    try {
      const messages = await globalClient!.session.messages({
        path: { id: sessionID },
      });

      if (messages.data) {
        const assistantMessages = messages.data.filter(
          (m) => m.info.role === "assistant"
        );

        if (assistantMessages.length > 0) {
          const lastMessage = assistantMessages[assistantMessages.length - 1];
          const textParts = (lastMessage.parts ?? []).filter(isTextPart);
          consecutiveErrors = 0;
          return textParts.map((p) => p.text).join("\n");
        }
      }

      await sleep(POLL_INTERVAL_MS);
    } catch (error) {
      consecutiveErrors++;
      lastError = error instanceof Error ? error : new Error(String(error));

      if (consecutiveErrors >= 5) {
        throw new Error(
          `Session failed after 5 consecutive errors: ${lastError.message}`
        );
      }

      await sleep(POLL_INTERVAL_MS);
    }
  }

  throw new Error(
    `Session timeout after ${timeout / 1000}s. Last error: ${lastError?.message ?? "none"}`
  );
}

async function cleanupSession(sessionID: string): Promise<void> {
  if (!globalClient) return;

  cleanupStats.totalAttempts++;

  try {
    await globalClient.session.delete({ path: { id: sessionID } });
    cleanupStats.successful++;
  } catch (error) {
    cleanupStats.failed++;
    const errorMessage = error instanceof Error ? error.message : String(error);

    cleanupStats.failures.push({
      sessionID,
      error: errorMessage,
      timestamp: Date.now(),
    });

    if (cleanupStats.failures.length > 100) {
      cleanupStats.failures.shift();
    }

    console.warn(`[agent-squad] Failed to cleanup session ${sessionID}: ${errorMessage}`);
  }
}

// ============================================================================
// DEVIL'S ADVOCATE SECOND-PASS EXECUTION
// ============================================================================

async function runDevilsAdvocateSecondPass(
  teamId: string,
  task: string,
  timeout: number
): Promise<ExecutionResult> {
  const team = teams.get(teamId);
  if (!team) {
    return {
      name: "devil-s-advocate",
      success: false,
      error: "Team not found for DA review",
    };
  }

  const otherResults: string[] = [];
  for (const [name, agent] of team.agents) {
    if (!isDevilsAdvocate(name) && agent.result) {
      otherResults.push(`### ${name}\n\n${agent.result}`);
    }
  }

  if (otherResults.length === 0) {
    return {
      name: "devil-s-advocate",
      success: false,
      error: "No other agent results to review",
    };
  }

  const daPrompt = `${task}\n\n## Other Agents' Analysis:\n\n${otherResults.join("\n\n---\n\n")}\n\n## Your Task:\nAs the Devil's Advocate, critically review the analysis above. Identify:\n1. What's wrong or missing\n2. Alternative approaches\n3. Edge cases others missed\n\nBe thorough and critical.`;

  let sessionID: string | undefined;
  try {
    const sessionResult = await spawnAgentSession("devil-s-advocate", daPrompt, teamId);
    sessionID = sessionResult.sessionID;

    const result = await waitForSessionCompletion(sessionID, timeout);

    return {
      name: "devil-s-advocate",
      success: true,
      result,
    };
  } catch (error) {
    return {
      name: "devil-s-advocate",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (sessionID) {
      try {
        await cleanupSession(sessionID);
      } catch (cleanupError) {
        const errorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        console.warn(`[agent-squad] Failed to cleanup DA session ${sessionID}: ${errorMessage}`);
      }
    }
  }
}

// ============================================================================
// TEAM MANAGEMENT
// ============================================================================

function enforceMaxTeams(): void {
  if (teams.size <= MAX_TEAMS) return;

  const entries = Array.from(teams.entries());
  entries.sort((a, b) => a[1].lastActivity.getTime() - b[1].lastActivity.getTime());

  const toRemove = entries.slice(0, teams.size - MAX_TEAMS);
  for (const [id, team] of toRemove) {
    for (const agent of team.agents.values()) {
      if (agent.sessionID) {
        cleanupSession(agent.sessionID).catch(() => {});
      }
    }
    teams.delete(id);
  }

  savePersistedTeams(teams);
}

function formatAgentContext(teamId: string, currentAgentName: string): string {
  const team = teams.get(teamId);
  if (!team) return "";

  const results: string[] = [];
  for (const [name, agent] of team.agents) {
    if (name === currentAgentName) continue;
    if (agent.result) {
      const { text } = truncateText(agent.result, MAX_CONTEXT_LENGTH);
      results.push(`**${name}**:\n${text}`);
    }
  }

  return results.length > 0 ? results.join("\n\n") : "No results yet from other agents.";
}

const MAX_CONTEXT_LENGTH = 500;

// ============================================================================
// AGENT EXECUTION
// ============================================================================

async function executeAgent(
  name: string,
  agent: Agent,
  task: string,
  timeout: number,
  teamId?: string
): Promise<ExecutionResult> {
  let sessionID: string | undefined;

  try {
    agent.status = "thinking";
    const sessionResult = await spawnAgentSession(name, task, teamId);
    sessionID = sessionResult.sessionID;
    agent.sessionID = sessionID;
    agent.status = "responding";

    const result = await waitForSessionCompletion(sessionID, timeout);
    agent.status = "completed";

    const { text: truncatedResult, wasTruncated } = truncateText(result, MAX_RESULT_LENGTH);
    agent.result = truncatedResult;
    agent.resultTruncated = wasTruncated;

    return { name, success: true, result: truncatedResult, truncated: wasTruncated };
  } catch (error) {
    agent.status = "error";
    agent.error = error instanceof Error ? error.message : String(error);
    return { name, success: false, error: agent.error };
  } finally {
    if (sessionID) {
      try {
        await cleanupSession(sessionID);
      } catch (cleanupError) {
        const errorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        console.warn(`[agent-squad] Failed to cleanup session ${sessionID}: ${errorMessage}`);
      }
      agent.sessionID = null;
    }

    if (teamId) {
      const team = teams.get(teamId);
      if (team) {
        team.lastActivity = new Date();
      }
    }
  }
}

function formatExecutionResults(team: Team, results: ExecutionResult[]): string {
  let output = "";
  let successCount = 0;
  let truncatedCount = 0;

  for (const r of results) {
    if (r.success && r.result) {
      successCount++;
      if (r.truncated) truncatedCount++;

      output += formatAgentHeader(r.name, "success");
      output += `${r.result}`;
      if (r.truncated) {
        output += `\n\n⚠️ *Output truncated to ${MAX_RESULT_LENGTH} chars*`;
      }
      output += `\n`;
    } else if (r.error) {
      output += formatAgentHeader(r.name, "error");
      output += `**Error**: ${r.error}\n`;
      if (r.error.includes("not defined")) {
        output += `\n💡 *Hint*: Check if agent is configured in opencode.json\n`;
      }
      output += `\n`;
    }
  }

  // Summary section
  output += formatSection("Summary");
  output += `✅ **Success**: ${successCount}/${results.length} agents completed\n`;

  if (truncatedCount > 0) {
    output += `⚠️ **Warning**: ${truncatedCount} results truncated (limit: ${MAX_RESULT_LENGTH} chars)\n`;
  }

  if (successCount === results.length) {
    output += `🎉 All agents completed successfully!\n`;
  } else if (successCount > 0) {
    output += `⚠️ Some agents failed - see errors above\n`;
  } else {
    output += `❌ All agents failed - please try again\n`;
  }

  // Cleanup stats (only if failures)
  if (cleanupStats.failed > 0) {
    output += `\n[Cleanup: ${cleanupStats.successful}/${cleanupStats.totalAttempts} successful, ${cleanupStats.failed} failed]\n`;
  }

  return output;
}

// ============================================================================
// ERROR MESSAGES WITH SUGGESTIONS
// ============================================================================

function getAgentNotFoundSuggestion(requestedAgents: string[]): string {
  const available = Object.keys(opencodeConfig);

  let msg = `❌ **Agent not found**\n\n`;
  msg += `Requested agents: ${requestedAgents.join(", ")}\n\n`;

  if (available.length === 0) {
    msg += `💡 **No agents configured** in opencode.json\n\n`;
    msg += `Fix: Add agents to your opencode.json:\n`;
    msg += `{\n  "agent": {\n    "code-reviewer": {\n      "description": "You are a code reviewer..."\n    }\n  }\n}`;
  } else {
    msg += `💡 **Available agents**: ${available.join(", ")}\n\n`;
    msg += `Suggestions:\n`;
    msg += `• Use available agents: /squad task="..." mode="fast"\n`;
    msg += `• Check spelling: ${requestedAgents.map(a => {
      const closest = available.find(av => av.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(av.toLowerCase()));
      return closest ? `"${a}" → "${closest}"` : `"${a}"`;
    }).join("\n    • ")}`;
  }

  return msg;
}

function getTeamNotFoundSuggestion(teamId: string): string {
  const teamIds = Array.from(teams.keys()).slice(0, 5);

  let msg = `❌ **Team not found**: "${teamId}"\n\n`;

  if (teamIds.length > 0) {
    msg += `💡 **Available teams**:\n`;
    for (const id of teamIds) {
      const team = teams.get(id);
      msg += `• \`${id}\` - ${team?.name} (${team?.agents.size} agents)\n`;
    }
    if (teams.size > 5) {
      msg += `• ... and ${teams.size - 5} more\n`;
    }
  } else {
    msg += `💡 **No persistent teams exist**\n\n`;
    msg += `Create a team first:\n`;
    msg += `/team-spawn preset="fast" teamName="myteam" task="..."`;
  }

  msg += `\n\n💡 Or use the one-shot command:\n`;
  msg += `/squad task="your task here"`;

  return msg;
}

// ============================================================================
// TOOLS
// ============================================================================

const squadTool = tool({
  description: formatBox(
    "🚀 /squad - Quick Multi-Agent Analysis",
    `Run multiple AI agents in parallel with Devil's Advocate review.

**Examples:**
  /squad task="Is this code secure?"
  /squad task="Review for bugs" mode="thorough"
  /squad task="Design a feature" mode="creative"

**Modes:**
  fast     → 2 agents  (quick questions)
  thorough  → 3 agents  (detailed analysis)
  review   → 3 agents  (code + security)
  creative → 6 agents  (brainstorming)

**Tips:**
  • Select code before running for context
  • DA runs second-pass to critique findings
  • Results cached for 5 minutes`,
    58
  ),
  args: {
    task: z.string().describe("Task to perform"),
    mode: z.enum(["fast", "thorough", "review", "creative"]).optional().default("fast")
      .describe("Execution mode"),
    useCache: z.boolean().optional().default(true).describe("Use cache (default: true)"),
    context: z.string().optional().describe("Additional context (code, files, etc.)"),
  },
  execute: async (params) => {
    const task = params.task as string;
    const mode = (params.mode as "fast" | "thorough" | "review" | "creative") || "fast";
    const useCache = params.useCache !== false;
    const context = params.context as string | undefined;

    // Check cache
    if (useCache) {
      const cached = squadCache.get(mode, task, context);
      if (cached) {
        return `💾 **Cached Result** (same request within 5 minutes)\n\n${cached}`;
      }
    }

    // Select agents based on task
    let agents: string[];
    let reason: string;

    if (mode === "creative") {
      agents = ["planner", "fullstack-developer", "frontend-developer", "backend-developer", "ui-designer", "devil-s-advocate"];
      reason = "🎨 Creative mode: Planning + Development + Design + DA";
    } else if (/security|vulnerability|auth|token|encrypt/i.test(task)) {
      agents = mode === "review"
        ? ["security-auditor", "code-reviewer", "devil-s-advocate"]
        : ["security-auditor", "devil-s-advocate"];
      reason = "🔒 Security task detected";
    } else if (/bug|error|debug|fix/i.test(task)) {
      agents = mode === "review"
        ? ["debugger", "code-reviewer", "devil-s-advocate"]
        : ["debugger", "devil-s-advocate"];
      reason = "🐛 Debug task detected";
    } else if (/implement|develop|create|add|feature/i.test(task)) {
      agents = mode === "fast"
        ? ["planner", "devil-s-advocate"]
        : ["planner", "fullstack-developer", "devil-s-advocate"];
      reason = "🔨 Implementation task detected";
    } else if (/plan|design|architecture/i.test(task)) {
      agents = ["planner", "devil-s-advocate"];
      reason = "📋 Planning task detected";
    } else if (/review|check|analyze/i.test(task)) {
      agents = mode === "fast"
        ? ["code-reviewer", "devil-s-advocate"]
        : ["code-reviewer", "security-auditor", "devil-s-advocate"];
      reason = "👁️ Review task detected";
    } else {
      agents = mode === "thorough"
        ? ["code-reviewer", "security-auditor", "devil-s-advocate"]
        : ["code-reviewer", "devil-s-advocate"];
      reason = "🔍 General analysis (review mode)";
    }

    // Validate agents
    const { valid, invalid } = validateAgentAvailability(agents);

    if (valid.length === 0) {
      return getAgentNotFoundSuggestion(agents);
    }

    // Cost warning
    const costNote = estimateAgentCost(valid.length);

    // Create ephemeral team
    const teamId = `squad-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const team: Team = {
      id: teamId,
      name: `squad-${mode}`,
      preset: "custom",
      agents: new Map(),
      createdAt: new Date(),
      lastActivity: new Date(),
      task,
    };

    for (const agentName of valid) {
      const agentDef = opencodeConfig[agentName];
      team.agents.set(agentName, {
        name: agentName,
        sessionID: null,
        role: extractRoleFromDescription(agentDef?.description, agentName),
        status: "idle",
      });
    }

    teams.set(teamId, team);

    // Build prompt
    let taskPrompt = task;
    if (context) {
      taskPrompt = `${task}\n\n## Context:\n${context}`;
    }
    taskPrompt += `\n\n## Output Guide\n- Be concise and focus on key points\n- Provide practical, actionable suggestions`;

    // Separate DA for second-pass
    const nonDAAgents = valid.filter(n => !isDevilsAdvocate(n));
    const hasDA = valid.some(n => isDevilsAdvocate(n));

    // Build output header
    let output = formatBox(
      `🚀 SQUAD EXECUTION (${mode.toUpperCase()})`,
      `${reason}\nAgents: ${valid.join(", ")}\n${invalid.length > 0 ? `⚠️ Skipped: ${invalid.join(", ")}` : ""}\n${costNote}`,
      60
    );

    // Execute
    const executeAgentWithRetry = async (agentName: string): Promise<{ name: string; success: boolean; result?: string; error?: string; truncated?: boolean }> => {
      let retries = 0;
      let success = false;
      let result: string | undefined;
      let error: string | undefined;
      let sessionID: string | undefined;
      let wasTruncated = false;

      try {
        while (!success && retries <= 2) {
          try {
            const sessionResult = await spawnAgentSession(agentName, taskPrompt, teamId);
            if (sessionResult) {
              sessionID = sessionResult.sessionID;
              result = await waitForSessionCompletion(sessionID, DEFAULT_TIMEOUT_MS);

              const { text: truncatedResult, wasTruncated: truncated } = truncateText(result!, MAX_RESULT_LENGTH);
              result = truncatedResult;
              wasTruncated = truncated;

              success = true;
            }
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
            retries++;
            if (retries <= 2) {
              await new Promise(resolve => setTimeout(resolve, 1000 * retries));
            }
          }
        }
      } finally {
        if (sessionID) {
          try {
            await cleanupSession(sessionID);
          } catch (cleanupError) {
            // Silent cleanup
          }
        }
      }

      return { name: agentName, success, result, error, truncated: wasTruncated };
    };

    const executionPromises = nonDAAgents.map(name => executeAgentWithRetry(name));
    const results = await Promise.allSettled(executionPromises);

    const settledResults: ExecutionResult[] = results.map((r) => {
      if (r.status === "fulfilled") {
        return r.value;
      }
      return {
        name: r.reason?.name || "unknown",
        success: false,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason)
      };
    });

    // DA second-pass
    if (hasDA) {
      output += `\n📊 **Phase 1**: Initial Analysis\n\n`;

      const daResult = await runDevilsAdvocateSecondPass(teamId, taskPrompt, DEFAULT_TIMEOUT_MS);

      output += `\n🎯 **Phase 2**: Devil's Advocate Review\n\n`;

      if (daResult.success) {
        const { text: truncatedResult, wasTruncated } = truncateText(daResult.result!, MAX_RESULT_LENGTH);
        daResult.result = truncatedResult;
        daResult.truncated = wasTruncated;
        settledResults.push(daResult);
      } else {
        settledResults.push(daResult);
      }
    }

    // Format agent results
    output += formatSection("Agent Results");
    let truncatedCount = 0;
    for (const r of settledResults) {
      if (r.success && r.result) {
        if (r.truncated) truncatedCount++;
        output += formatAgentHeader(r.name, "success");
        output += `${r.result}`;
        if (r.truncated) {
          output += `\n\n⚠️ *Output truncated*`;
        }
        output += `\n`;
      } else if (r.error) {
        output += formatAgentHeader(r.name, "error");
        output += `${r.error}\n`;
      }
    }

    // Summary
    const successCount = settledResults.filter(r => r.success).length;
    output += formatSection("Summary");
    output += `✅ **Success**: ${successCount}/${settledResults.length} agents completed\n`;

    if (truncatedCount > 0) {
      output += `⚠️ **Warning**: ${truncatedCount} outputs truncated (max ${MAX_RESULT_LENGTH} chars)\n`;
    }

    if (successCount === settledResults.length) {
      output += `🎉 All agents completed!\n`;
    } else if (successCount > 0) {
      output += `⚠️ Some agents failed - see errors above\n`;
    } else {
      output += `❌ All agents failed - please try again\n`;
    }

    // Cleanup stats
    if (cleanupStats.failed > 0) {
      output += `\n[Cleanup: ${cleanupStats.successful}/${cleanupStats.totalAttempts} ok, ${cleanupStats.failed} failed]\n`;
    }

    // Save to cache
    if (useCache && successCount > 0) {
      squadCache.set(mode, task, output, context);
    }

    // Cleanup
    teams.delete(teamId);

    return output;
  },
});

const teamSpawnTool = tool({
  description: formatBox(
    "👥 /team-spawn - Create Persistent Team",
    `Create a team that persists across sessions.

**Examples:**
  /team-spawn preset="fast" teamName="reviewers" task="Code review"
  /team-spawn preset="security,code-reviewer" teamName="audit" task="Security audit"

**Presets:** fast, thorough, review, creative, security, debug, plan
**Or use custom agents:** preset="agent1,agent2,agent3"

**Features:**
  • Team saved to disk (~/.opencode/agent-squad-teams.json)
  • Survives restarts and crashes
  • Use with /team-execute and /team-discuss`,
    56
  ),
  args: {
    preset: z.string().describe("Preset name or comma-separated agents"),
    teamName: z.string().describe("Unique name for the team"),
    task: z.string().describe("Default task for the team"),
  },
  async execute(args) {
    if (!globalClient) {
      return "❌ Error: OpenCode client not available";
    }

    if (!args.teamName?.trim()) {
      return `❌ **Error**: teamName is required\n\n💡 Example: /team-spawn preset="fast" teamName="myteam" task="..."`;
    }
    if (!args.task?.trim()) {
      return `❌ **Error**: task is required\n\n💡 Example: /team-spawn preset="fast" teamName="myteam" task="Review this code"`;
    }

    const presetValue = args.preset ?? DEFAULT_PRESET;
    const teamId = `team-${Date.now()}-${randomUUID().slice(0, 8)}`;

    const agentNames = PRESETS[presetValue] ??
      presetValue.split(",").map((s) => s.trim()).filter(Boolean);

    if (agentNames.length === 0) {
      return `❌ **Error**: No agents specified\n\n💡 ${getSuggestedAgents("fast")}`;
    }

    // Validate agents
    const { valid, invalid } = validateAgentAvailability(agentNames);

    if (valid.length === 0) {
      return getAgentNotFoundSuggestion(agentNames);
    }

    const costNote = estimateAgentCost(valid.length);

    const team: Team = {
      id: teamId,
      name: args.teamName,
      preset: presetValue,
      agents: new Map(),
      createdAt: new Date(),
      lastActivity: new Date(),
      task: args.task,
    };

    for (const name of valid) {
      const agentDef = opencodeConfig[name];
      team.agents.set(name, {
        name,
        sessionID: null,
        role: extractRoleFromDescription(agentDef?.description, name),
        status: "idle",
      });
    }

    teams.set(teamId, team);
    enforceMaxTeams();
    savePersistedTeams(teams);

    // Format output
    let output = formatBox(
      `👥 Team "${args.teamName}" Created`,
      `Team ID: \`${teamId}\`\nAgents: ${team.agents.size}\n\n💾 Saved to disk - survives restarts!`,
      56
    );

    output += `\n**Agents** (${valid.length}):\n`;
    for (const [name, agent] of team.agents) {
      output += `  ✅ ${name} (${agent.role})\n`;
    }

    if (invalid.length > 0) {
      output += `\n⚠️ **Skipped** (not configured): ${invalid.join(", ")}\n`;
    }

    if (costNote) {
      output += `\n${costNote}\n`;
    }

    output += `\n**Task**: ${args.task}\n`;
    output += `\n💡 **Next steps**:\n`;
    output += `  Run: \`/team-execute teamId="${teamId}"\`\n`;
    output += `  Discuss: \`/team-discuss teamId="${teamId}" topic="..." round=2\``;

    return output;
  },
});

const teamExecuteTool = tool({
  description: formatBox(
    "⚡ /team-execute - Run Team (DA Second-Pass)",
    `Execute all agents in parallel.

**Example:**
  /team-execute teamId="team-xxx"

**Features:**
  • Parallel execution for speed
  • Devil's Advocate runs as second-pass
  • Results saved in team state
  • Follow up with /team-discuss`,
    54
  ),
  args: {
    teamId: z.string().describe("Team ID"),
    timeout: z.number().optional().describe("Timeout in seconds per agent (default: 90)"),
  },
  async execute(args) {
    if (!globalClient) {
      return "❌ Error: OpenCode client not available";
    }

    const team = teams.get(args.teamId);
    if (!team) {
      return getTeamNotFoundSuggestion(args.teamId);
    }

    const timeout = (args.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000;

    // Separate DA from other agents
    const nonDAAgents: Array<[string, Agent]> = [];
    let hasDA = false;

    for (const [name, agent] of team.agents) {
      if (isDevilsAdvocate(name)) {
        hasDA = true;
      } else {
        nonDAAgents.push([name, agent]);
      }
    }

    let output = formatBox(
      `⚡ Executing "${team.name}"`,
      `Task: ${team.task.slice(0, 50)}\nAgents: ${team.agents.size}\n${hasDA ? "Mode: Parallel → DA second-pass" : "Mode: Parallel only"}`,
      56
    );

    // Phase 1: Execute non-DA agents
    const executionPromises = nonDAAgents.map(
      ([name, agent]) => executeAgent(name, agent, team.task, timeout, args.teamId)
    );

    const results = await Promise.allSettled(executionPromises);
    const settledResults: ExecutionResult[] = results.map((r, index) => {
      const agentName = nonDAAgents[index][0];
      if (r.status === "fulfilled") {
        return r.value;
      }
      return {
        name: agentName,
        success: false,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      };
    });

    // Phase 2: DA second-pass
    if (hasDA) {
      output += `\n📊 **Phase 1**: Initial analysis complete\n\n`;

      const daResult = await runDevilsAdvocateSecondPass(args.teamId, team.task, timeout);

      output += `🎯 **Phase 2**: Devil's Advocate review\n\n`;

      if (daResult.success) {
        const daAgent = team.agents.get("devil-s-advocate");
        if (daAgent) {
          const { text: truncatedResult, wasTruncated } = truncateText(daResult.result!, MAX_RESULT_LENGTH);
          daAgent.result = truncatedResult;
          daAgent.resultTruncated = wasTruncated;
        }
        settledResults.push(daResult);
      } else {
        settledResults.push(daResult);
      }
    }

    // Format results
    output += formatExecutionResults(team, settledResults);

    // Update and persist
    team.lastActivity = new Date();
    savePersistedTeams(teams);

    output += `\n💾 **Team saved** - ID: \`${team.id}\`\n`;
    output += `💡 Continue: \`/team-discuss teamId="${team.id}" topic="..." round=2\``;

    return output;
  },
});

const teamDiscussTool = tool({
  description: formatBox(
    "💬 /team-discuss - Multi-Round Discussion",
    `Agents discuss sequentially, seeing each other's results.

**Example:**
  /team-discuss teamId="team-xxx" topic="Best approach?" round=2

**Features:**
  • Sequential rounds with context sharing
  • Each agent sees previous results
  • Team state saved after discussion`,
    52
  ),
  args: {
    teamId: z.string().describe("Team ID"),
    topic: z.string().describe("Discussion topic"),
    rounds: z.number().optional().describe("Number of rounds (default: 2, max: 3)"),
  },
  async execute(args) {
    if (!globalClient) {
      return "❌ Error: OpenCode client not available";
    }

    if (!args.teamId?.trim()) {
      return `❌ **Error**: teamId is required\n\n💡 Get team ID from /team-spawn output`;
    }
    if (!args.topic?.trim()) {
      return `❌ **Error**: topic is required\n\n💡 Example: /team-discuss teamId="..." topic="What's the best approach?"`;
    }

    const team = teams.get(args.teamId);
    if (!team) {
      return getTeamNotFoundSuggestion(args.teamId);
    }

    const rounds = Math.min(Math.max(args.rounds ?? 2, 1), 3);

    let output = formatBox(
      `💬 Discussion: ${args.topic.slice(0, 40)}...`,
      `Team: ${team.name}\nRounds: ${rounds}\nAgents: ${team.agents.size}`,
      50
    );

    for (let r = 1; r <= rounds; r++) {
      output += `\n${"─".repeat(40)} **Round ${r}** ${"─".repeat(40)}\n\n`;

      for (const [name, agent] of team.agents) {
        const agentContext = formatAgentContext(args.teamId, name);

        const prompt = r === 1
          ? `${args.topic}\n\nYou are ${name}. Please analyze.`
          : `${args.topic}\n\n## Other Agents' Opinions:\n${agentContext}\n\n## Additional Analysis:\nAs ${name}, provide new perspectives or counterarguments.`;

        let sessionID: string | undefined;

        try {
          agent.status = "thinking";
          const sessionResult = await spawnAgentSession(name, prompt, args.teamId);
          sessionID = sessionResult.sessionID;
          agent.status = "responding";

          const result = await waitForSessionCompletion(sessionID, DEFAULT_TIMEOUT_MS);
          agent.status = "completed";

          const { text: truncatedResult, wasTruncated } = truncateText(result, MAX_DISCUSSION_RESULT_LENGTH);
          agent.result = truncatedResult;
          agent.resultTruncated = wasTruncated;

          output += `**${name}**:\n`;
          output += truncatedResult;
          if (wasTruncated) {
            output += ` \n\n[...truncated...]`;
          }
          output += `\n\n`;
        } catch (error) {
          agent.status = "error";
          agent.error = error instanceof Error ? error.message : String(error);

          output += `**${name}**: ❌ ${agent.error}\n\n`;
        } finally {
          if (sessionID) {
            try {
              await cleanupSession(sessionID);
            } catch (cleanupError) {
              // Silent
            }
            agent.sessionID = null;
          }
        }
      }
    }

    // Update and persist
    team.lastActivity = new Date();
    savePersistedTeams(teams);

    output += `${"─".repeat(40)}\n`;
    output += `💾 **Team saved** - ID: \`${team.id}\`\n`;
    output += `💡 Re-run: \`/team-execute teamId="${team.id}"\``;

    return output;
  },
});

// ============================================================================
// PLUGIN EXPORT
// ============================================================================

export default async function plugin(input: PluginInput): Promise<Hooks> {
  globalClient = input.client;
  opencodeConfig = loadOpenCodeAgents();

  const persistedTeams = loadPersistedTeams();
  for (const [id, team] of persistedTeams) {
    teams.set(id, team);
  }

  return {
    tool: {
      "squad": squadTool,
      "team-spawn": teamSpawnTool,
      "team-execute": teamExecuteTool,
      "team-discuss": teamDiscussTool,
    },
  };
}
