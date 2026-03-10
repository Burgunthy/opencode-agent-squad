import { tool } from "@opencode-ai/plugin";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { createHash } from "crypto";
const z = tool.schema;
// ============================================================================
// CONSTANTS
// ============================================================================
const MAX_TEAMS = 50;
const DEFAULT_TIMEOUT_MS = 90000;
const POLL_INTERVAL_MS = 1500;
const MAX_RESULT_LENGTH = 3000; // Increased from 2000
const MAX_DISCUSSION_RESULT_LENGTH = 1500; // Increased from 1000
const DEFAULT_PRESET = "review";
const DEFAULT_TIMEOUT_SECONDS = 90;
class SquadCache {
    cache;
    ttl;
    maxSize;
    constructor(ttl = 5 * 60 * 1000, maxSize = 100) {
        this.cache = new Map();
        this.ttl = ttl;
        this.maxSize = maxSize;
    }
    generateKey(mode, task, context) {
        // Include mode, task hash, and optional context hash
        const taskHash = createHash("md5").update(task).digest("hex").slice(0, 8);
        const contextHash = context
            ? createHash("md5").update(context).digest("hex").slice(0, 8)
            : "none";
        return `${mode}:${taskHash}:${contextHash}`;
    }
    get(mode, task, context) {
        const key = this.generateKey(mode, task, context);
        const entry = this.cache.get(key);
        if (!entry)
            return null;
        const now = Date.now();
        if (now - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            return null;
        }
        // Update access stats for LRU
        entry.accessCount++;
        entry.lastAccess = now;
        return entry.result;
    }
    set(mode, task, result, context) {
        // Clean expired entries
        this.cleanExpired();
        // Enforce max size using LRU (remove least recently accessed)
        if (this.cache.size >= this.maxSize) {
            let lruKey = null;
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
    cleanExpired() {
        const now = Date.now();
        for (const [key, entry] of this.cache) {
            if (now - entry.timestamp > this.ttl) {
                this.cache.delete(key);
            }
        }
    }
    clear() {
        this.cache.clear();
    }
    get size() {
        return this.cache.size;
    }
}
const cleanupStats = {
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
function isDevilsAdvocate(agentName) {
    const normalized = agentName.toLowerCase().replace(/[_-]/g, "");
    return DEVILS_ADVOCATE_NAMES.some(name => normalized === name.replace(/[_-]/g, ""));
}
// ============================================================================
// TEAM PERSISTENCE
// ============================================================================
const TEAMS_PERSIST_FILE = path.join(process.env.HOME || "~", ".opencode", "agent-squad-teams.json");
function loadPersistedTeams() {
    try {
        if (fs.existsSync(TEAMS_PERSIST_FILE)) {
            const data = fs.readFileSync(TEAMS_PERSIST_FILE, "utf-8");
            const rawTeams = JSON.parse(data);
            const teams = new Map();
            for (const [id, raw] of Object.entries(rawTeams)) {
                const team = raw;
                // Reconstruct Map from plain object
                team.agents = new Map(Object.entries(team.agents));
                team.createdAt = new Date(team.createdAt);
                team.lastActivity = new Date(team.lastActivity || team.createdAt);
                teams.set(id, team);
            }
            console.log(`[agent-squad] Loaded ${teams.size} persisted teams`);
            return teams;
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`[agent-squad] Failed to load persisted teams: ${errorMessage}`);
    }
    return new Map();
}
function savePersistedTeams(teams) {
    try {
        // Ensure directory exists
        const dir = path.dirname(TEAMS_PERSIST_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        // Convert to plain object for JSON serialization
        const rawTeams = {};
        for (const [id, team] of teams) {
            rawTeams[id] = {
                ...team,
                agents: Object.fromEntries(team.agents),
                createdAt: team.createdAt.toISOString(),
                lastActivity: team.lastActivity.toISOString(),
            };
        }
        fs.writeFileSync(TEAMS_PERSIST_FILE, JSON.stringify(rawTeams, null, 2));
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`[agent-squad] Failed to persist teams: ${errorMessage}`);
    }
}
// ============================================================================
// GLOBAL STATE
// ============================================================================
let globalClient = null;
let opencodeConfig = {};
const teams = loadPersistedTeams();
const squadCache = new SquadCache(5 * 60 * 1000, 100);
// ============================================================================
// PRESETS
// ============================================================================
const PRESETS = {
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
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function truncateText(text, maxLength) {
    if (text.length <= maxLength) {
        return { text, wasTruncated: false };
    }
    return { text: text.slice(0, maxLength - 12) + "\n\n[...TRUNCATED...]", wasTruncated: true };
}
function loadOpenCodeAgents() {
    try {
        const configPath = path.join(process.cwd(), "opencode.json");
        const configContent = fs.readFileSync(configPath, "utf-8");
        const config = JSON.parse(configContent);
        return config.agent ?? {};
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`[agent-squad] Failed to load opencode.json: ${errorMessage}`);
        return {};
    }
}
function extractRoleFromDescription(description, agentName) {
    if (!description)
        return agentName;
    const match = description.match(/^You are (?:a|an) ([^.]+)\./i);
    return match ? match[1] : agentName;
}
function validateAgentAvailability(agentNames) {
    const valid = [];
    const invalid = [];
    for (const name of agentNames) {
        if (opencodeConfig[name]) {
            valid.push(name);
        }
        else {
            invalid.push(name);
        }
    }
    return { valid, invalid };
}
function estimateAgentCost(agentCount, mode) {
    // Rough estimate: ~1000 tokens per agent response
    const estimatedTokens = agentCount * 1000;
    const costPer1k = 0.003; // Conservative estimate for Opus
    const estimatedCost = (estimatedTokens / 1000) * costPer1k;
    if (agentCount >= 4) {
        return `⚠️ Cost warning: Running ${agentCount} agents may cost ~$${estimatedCost.toFixed(4)}. Continue?`;
    }
    return "";
}
// ============================================================================
// REAL AGENT EXECUTION
// ============================================================================
async function spawnAgentSession(agentName, task, teamId) {
    if (!globalClient) {
        throw new Error("OpenCode client not initialized");
    }
    const sessionResponse = await globalClient.session.create({});
    const sessionID = sessionResponse.data?.id;
    if (!sessionID) {
        throw new Error("Failed to create session: no session ID returned");
    }
    const agentConfig = opencodeConfig[agentName];
    // Apply Devil's Advocate prompt if applicable
    const isDA = isDevilsAdvocate(agentName);
    const basePrompt = agentConfig?.prompt_append || "";
    // Build system prompt
    const effectiveSystemPrompt = isDA
        ? basePrompt + "\n\n" + DEVILS_ADVOCATE_PROMPT
        : basePrompt;
    // Add other agents' results to context (for sequential discussion)
    let fullTask = task;
    if (teamId && !isDA) {
        // DA runs separately in second-pass
        const agentContext = formatAgentContext(teamId, agentName);
        if (agentContext && !agentContext.includes("No results yet")) {
            fullTask = `${task}\n\n## Other Team Members' Results:\n${agentContext}\n\nConsider this information when performing your task.`;
        }
    }
    const promptBody = {
        parts: [{ type: "text", text: fullTask }],
        agent: agentName,
    };
    if (effectiveSystemPrompt) {
        promptBody.system = effectiveSystemPrompt;
    }
    if (agentConfig?.model) {
        const parts = agentConfig.model.split("/");
        if (parts.length >= 2) {
            promptBody.model = { providerID: parts[0], modelID: parts.slice(1).join("/") };
        }
        else {
            console.warn(`[agent-squad] Invalid model format "${agentConfig.model}", expected "provider/model"`);
        }
    }
    await globalClient.session.prompt({
        path: { id: sessionID },
        body: promptBody,
    });
    return { sessionID, agent: agentConfig };
}
async function waitForSessionCompletion(sessionID, timeout = DEFAULT_TIMEOUT_MS) {
    const startTime = Date.now();
    let lastError = null;
    let consecutiveErrors = 0;
    const isTextPart = (p) => p.type === "text" && "text" in p;
    while (Date.now() - startTime < timeout) {
        try {
            const messages = await globalClient.session.messages({
                path: { id: sessionID },
            });
            if (messages.data) {
                const assistantMessages = messages.data.filter((m) => m.info.role === "assistant");
                if (assistantMessages.length > 0) {
                    const lastMessage = assistantMessages[assistantMessages.length - 1];
                    const textParts = (lastMessage.parts ?? []).filter(isTextPart);
                    consecutiveErrors = 0;
                    return textParts.map((p) => p.text).join("\n");
                }
            }
            await sleep(POLL_INTERVAL_MS);
        }
        catch (error) {
            consecutiveErrors++;
            lastError = error instanceof Error ? error : new Error(String(error));
            if (consecutiveErrors >= 5) {
                throw new Error(`Session failed after 5 consecutive errors: ${lastError.message}`);
            }
            await sleep(POLL_INTERVAL_MS);
        }
    }
    throw new Error(`Session timeout after ${timeout / 1000}s. Last error: ${lastError?.message ?? "none"}`);
}
async function cleanupSession(sessionID) {
    if (!globalClient)
        return;
    cleanupStats.totalAttempts++;
    try {
        await globalClient.session.delete({ path: { id: sessionID } });
        cleanupStats.successful++;
    }
    catch (error) {
        cleanupStats.failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Track failure
        cleanupStats.failures.push({
            sessionID,
            error: errorMessage,
            timestamp: Date.now(),
        });
        // Keep only last 100 failures
        if (cleanupStats.failures.length > 100) {
            cleanupStats.failures.shift();
        }
        console.warn(`[agent-squad] Failed to cleanup session ${sessionID}: ${errorMessage}`);
    }
}
// ============================================================================
// DEVIL'S ADVOCATE SECOND-PASS EXECUTION
// ============================================================================
async function runDevilsAdvocateSecondPass(teamId, task, timeout) {
    const team = teams.get(teamId);
    if (!team) {
        return {
            name: "devil-s-advocate",
            success: false,
            error: "Team not found for DA review",
        };
    }
    // Collect all other agents' results
    const otherResults = [];
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
    // Build DA prompt with other results
    const daPrompt = `${task}\n\n## Other Agents' Analysis:\n\n${otherResults.join("\n\n---\n\n")}\n\n## Your Task:\nAs the Devil's Advocate, critically review the analysis above. Identify:\n1. What's wrong or missing\n2. Alternative approaches\n3. Edge cases others missed\n\nBe thorough and critical.`;
    let sessionID;
    try {
        const sessionResult = await spawnAgentSession("devil-s-advocate", daPrompt, teamId);
        sessionID = sessionResult.sessionID;
        const result = await waitForSessionCompletion(sessionID, timeout);
        return {
            name: "devil-s-advocate",
            success: true,
            result,
        };
    }
    catch (error) {
        return {
            name: "devil-s-advocate",
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
    finally {
        if (sessionID) {
            try {
                await cleanupSession(sessionID);
            }
            catch (cleanupError) {
                const errorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
                console.warn(`[agent-squad] Failed to cleanup DA session ${sessionID}: ${errorMessage}`);
            }
        }
    }
}
// ============================================================================
// TEAM MANAGEMENT
// ============================================================================
function enforceMaxTeams() {
    if (teams.size <= MAX_TEAMS)
        return;
    const entries = Array.from(teams.entries());
    entries.sort((a, b) => a[1].lastActivity.getTime() - b[1].lastActivity.getTime());
    const toRemove = entries.slice(0, teams.size - MAX_TEAMS);
    for (const [id, team] of toRemove) {
        for (const agent of team.agents.values()) {
            if (agent.sessionID) {
                cleanupSession(agent.sessionID).catch(() => { });
            }
        }
        teams.delete(id);
    }
    // Persist after cleanup
    savePersistedTeams(teams);
}
function formatAgentContext(teamId, currentAgentName) {
    const team = teams.get(teamId);
    if (!team)
        return "";
    const results = [];
    for (const [name, agent] of team.agents) {
        if (name === currentAgentName)
            continue;
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
async function executeAgent(name, agent, task, timeout, teamId) {
    let sessionID;
    try {
        agent.status = "thinking";
        const sessionResult = await spawnAgentSession(name, task, teamId);
        sessionID = sessionResult.sessionID;
        agent.sessionID = sessionID;
        agent.status = "responding";
        const result = await waitForSessionCompletion(sessionID, timeout);
        agent.status = "completed";
        // Store with truncation info
        const { text: truncatedResult, wasTruncated } = truncateText(result, MAX_RESULT_LENGTH);
        agent.result = truncatedResult;
        agent.resultTruncated = wasTruncated;
        return { name, success: true, result: truncatedResult, truncated: wasTruncated };
    }
    catch (error) {
        agent.status = "error";
        agent.error = error instanceof Error ? error.message : String(error);
        return { name, success: false, error: agent.error };
    }
    finally {
        // Cleanup session in both success and error paths
        if (sessionID) {
            try {
                await cleanupSession(sessionID);
            }
            catch (cleanupError) {
                const errorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
                console.warn(`[agent-squad] Failed to cleanup session ${sessionID}: ${errorMessage}`);
            }
            // Clear sessionID to prevent double-cleanup
            agent.sessionID = null;
        }
        // Update team activity
        if (teamId) {
            const team = teams.get(teamId);
            if (team) {
                team.lastActivity = new Date();
            }
        }
    }
}
function formatExecutionResults(team, results) {
    let output = `---\n\n`;
    let successCount = 0;
    let truncatedCount = 0;
    for (const r of results) {
        if (r.success && r.result) {
            successCount++;
            if (r.truncated)
                truncatedCount++;
            output += `### ${r.name}\n\n`;
            output += r.result;
            if (r.truncated) {
                output += `\n\n⚠️ *Result was truncated to ${MAX_RESULT_LENGTH} characters*`;
            }
            output += `\n\n`;
        }
        else if (r.error) {
            output += `### ${r.name}\n\n`;
            output += `**Error**: ${r.error}\n\n`;
        }
    }
    output += `---\n`;
    output += `**Result**: ${successCount}/${results.length} agents succeeded\n`;
    if (truncatedCount > 0) {
        output += `⚠️ ${truncatedCount} results were truncated.\n`;
    }
    if (successCount === results.length) {
        output += `All agents completed successfully.\n`;
    }
    else if (successCount > 0) {
        output += `Some agents failed. Please review the results.\n`;
    }
    else {
        output += `All agents failed. Please try again.\n`;
    }
    // Show cleanup stats if there were failures
    if (cleanupStats.failed > 0) {
        output += `\n[Cleanup: ${cleanupStats.successful}/${cleanupStats.totalAttempts} successful`;
        if (cleanupStats.failed > 0) {
            output += `, ${cleanupStats.failed} failed]`;
        }
        else {
            output += `]`;
        }
    }
    return output;
}
// ============================================================================
// TOOLS
// ============================================================================
const teamSpawnTool = tool({
    description: "Spawn a real agent team with actual OpenCode subagents. Teams persist across sessions.",
    args: {
        preset: z
            .string()
            .optional()
            .describe("Preset name or comma-separated agent names"),
        teamName: z.string().describe("Name for the team"),
        task: z.string().describe("Task description for the team"),
    },
    async execute(args) {
        if (!globalClient) {
            return "Error: OpenCode client not available";
        }
        if (!args.teamName || args.teamName.trim() === "") {
            return `Error: Team name is required`;
        }
        if (!args.task || args.task.trim() === "") {
            return `Error: Task description is required`;
        }
        const presetValue = args.preset ?? DEFAULT_PRESET;
        const teamId = `team-${Date.now()}-${randomUUID().slice(0, 8)}`;
        const agentNames = PRESETS[presetValue] ??
            presetValue.split(",").map((s) => s.trim()).filter(Boolean);
        if (agentNames.length === 0) {
            return `Error: No agents specified. Available: ${Object.keys(opencodeConfig).join(", ")}`;
        }
        // Validate agent availability BEFORE creating team
        const { valid, invalid } = validateAgentAvailability(agentNames);
        if (valid.length === 0) {
            return `Error: No valid agents found. Requested: ${agentNames.join(", ")}. Available: ${Object.keys(opencodeConfig).join(", ")}`;
        }
        const costWarning = estimateAgentCost(valid.length, presetValue);
        const team = {
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
        let response = `## Team "${args.teamName}" Created\n\n`;
        response += `**Team ID**: ${teamId}\n`;
        response += `**Preset**: ${presetValue}\n`;
        response += `**Agents**: ${team.agents.size}\n`;
        response += `**Persistence**: Team saved to disk, survives restarts\n\n`;
        response += `### Agents\n`;
        for (const [name, agent] of team.agents) {
            response += `- **${name}** (${agent.role}) [OK]\n`;
        }
        if (invalid.length > 0) {
            response += `\n⚠️ **Skipped (not in config)**: ${invalid.join(", ")}\n`;
        }
        if (costWarning) {
            response += `\n${costWarning}\n`;
        }
        response += `\n### Task\n${args.task}\n`;
        response += `\n---\n`;
        response += `Use \`/team-execute teamId="${teamId}"\` to run.\n`;
        return response;
    },
});
const teamExecuteTool = tool({
    description: "Execute team agents in parallel. DA runs as second-pass to review others' results.",
    args: {
        teamId: z.string().describe("Team ID to execute"),
        timeout: z.number().optional().describe("Timeout in seconds per agent"),
    },
    async execute(args) {
        if (!globalClient) {
            return "Error: OpenCode client not available";
        }
        const team = teams.get(args.teamId);
        if (!team) {
            return `Error: Team ${args.teamId} not found. Available teams: ${Array.from(teams.keys()).join(", ")}`;
        }
        const timeout = (args.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
        // Separate DA from other agents
        const nonDAAgents = [];
        let hasDA = false;
        for (const [name, agent] of team.agents) {
            if (isDevilsAdvocate(name)) {
                hasDA = true;
            }
            else {
                nonDAAgents.push([name, agent]);
            }
        }
        let response = `## Executing Team "${team.name}"\n\n`;
        response += `**Task**: ${team.task}\n`;
        response += `**Agents**: ${team.agents.size}\n`;
        if (hasDA) {
            response += `**Mode**: Parallel execution, DA reviews as second-pass\n`;
        }
        response += `\n`;
        // Phase 1: Execute non-DA agents in parallel
        const executionPromises = nonDAAgents.map(([name, agent]) => executeAgent(name, agent, team.task, timeout, args.teamId));
        const results = await Promise.allSettled(executionPromises);
        const settledResults = results.map((r, index) => {
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
        // Phase 2: Run DA as second-pass if present
        if (hasDA) {
            response += `**Phase 1: Initial Analysis**\n\n`;
            const daResult = await runDevilsAdvocateSecondPass(args.teamId, team.task, timeout);
            response += `**Phase 2: Devil's Advocate Review**\n\n`;
            if (daResult.success) {
                const daAgent = team.agents.get("devil-s-advocate");
                if (daAgent) {
                    const { text: truncatedResult, wasTruncated } = truncateText(daResult.result, MAX_RESULT_LENGTH);
                    daAgent.result = truncatedResult;
                    daAgent.resultTruncated = wasTruncated;
                }
                settledResults.push(daResult);
            }
            else {
                settledResults.push(daResult);
            }
        }
        response += formatExecutionResults(team, settledResults);
        response += `\n**Team ID**: ${team.id}`;
        response += `\n**Team persists**: Use \`/team-discuss teamId="${team.id}"\` to continue discussion.`;
        // Update team activity and persist
        team.lastActivity = new Date();
        savePersistedTeams(teams);
        return response;
    },
});
const teamDiscussTool = tool({
    description: "Run a discussion between team agents with context sharing. Team state persists.",
    args: {
        teamId: z.string().describe("Team ID"),
        topic: z.string().describe("Discussion topic"),
        rounds: z.number().optional().describe("Number of rounds (default: 2, max: 3)"),
    },
    async execute(args) {
        if (!globalClient) {
            return "Error: OpenCode client not available";
        }
        if (!args.teamId || args.teamId.trim() === "") {
            return `Error: Team ID is required`;
        }
        if (!args.topic || args.topic.trim() === "") {
            return `Error: Discussion topic is required`;
        }
        const team = teams.get(args.teamId);
        if (!team) {
            return `Error: Team ${args.teamId} not found. Available teams: ${Array.from(teams.keys()).join(", ")}`;
        }
        const rounds = Math.min(Math.max(args.rounds ?? 2, 1), 3);
        let response = `## Discussion: ${args.topic.slice(0, 100)}\n\n`;
        response += `**Team**: ${team.name}\n`;
        response += `**Rounds**: ${rounds}\n`;
        response += `**Team ID**: ${team.id}\n\n`;
        for (let r = 1; r <= rounds; r++) {
            response += `### Round ${r}\n\n`;
            for (const [name, agent] of team.agents) {
                const agentContext = formatAgentContext(args.teamId, name);
                const prompt = r === 1
                    ? `${args.topic}\n\nYou are ${name}. Please analyze.`
                    : `${args.topic}\n\n## Other Agents' Opinions:\n${agentContext}\n\n## Additional Analysis:\nAs ${name}, provide new perspectives or counterarguments. Find what other agents missed.`;
                let sessionID;
                try {
                    agent.status = "thinking";
                    const sessionResult = await spawnAgentSession(name, prompt, args.teamId);
                    sessionID = sessionResult.sessionID;
                    agent.sessionID = sessionID;
                    agent.status = "responding";
                    const result = await waitForSessionCompletion(sessionID, DEFAULT_TIMEOUT_MS);
                    agent.status = "completed";
                    const { text: truncatedResult, wasTruncated } = truncateText(result, MAX_DISCUSSION_RESULT_LENGTH);
                    agent.result = truncatedResult;
                    agent.resultTruncated = wasTruncated;
                    response += `**${name}**:\n`;
                    response += truncatedResult;
                    if (wasTruncated) {
                        response += ` \n\n[...truncated...]`;
                    }
                    response += `\n\n`;
                }
                catch (error) {
                    agent.status = "error";
                    agent.error = error instanceof Error ? error.message : String(error);
                    response += `**${name}**: [FAIL] Error - ${agent.error}\n\n`;
                }
                finally {
                    // Cleanup session after discussion (in both success and error paths)
                    if (sessionID) {
                        try {
                            await cleanupSession(sessionID);
                        }
                        catch (cleanupError) {
                            const errorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
                            console.warn(`[agent-squad] Failed to cleanup session ${sessionID}: ${errorMessage}`);
                        }
                        // Clear sessionID to prevent double-cleanup
                        agent.sessionID = null;
                    }
                }
            }
        }
        // Update team activity and persist
        team.lastActivity = new Date();
        savePersistedTeams(teams);
        response += `---\n`;
        response += `**Team ID**: ${team.id}\n`;
        response += `**Team persists**: All results saved. Use \`/team-execute teamId="${team.id}"\` to run again.`;
        return response;
    },
});
// ============================================================================
// V2: SIMPLIFIED ALL-IN-ONE TOOL
// ============================================================================
const squadTool = tool({
    description: `[V2 Improved] Create and execute a team in one command.

**Improvements from DA feedback:**
- Proper LRU cache with TTL (not O(n) scan)
- Agent availability validation before execution
- Devil's Advocate runs as second-pass (reviews others' results)
- Cost warnings for large teams
- Truncation warnings (not silent)
- Team persistence (survives restarts)
- Session cleanup tracking

**Examples:**
- /squad task="Analyze security vulnerabilities in this code"
- /squad task="Help me fix this bug" mode="fast"
- /squad task="Plan new feature implementation" mode="thorough"
- /squad task="Brainstorm innovative ideas" mode="creative"

**Modes:**
- fast (default): 2 agents, quick response
- thorough: 3 agents, deep analysis
- review: 3+security, comprehensive code review
- creative: 5+DA, creative development team`,
    args: {
        task: z.string().describe("Task to perform"),
        mode: z.enum(["fast", "thorough", "review", "creative"]).optional().default("fast")
            .describe("fast: 2 agents, thorough: 3 agents, review: 3+security, creative: 5+DA"),
        useCache: z.boolean().optional().default(true).describe("Use cache (default: true)"),
        context: z.string().optional().describe("Additional context (code, files, etc.)"),
    },
    execute: async (params) => {
        const task = params.task;
        const mode = params.mode || "fast";
        const useCache = params.useCache !== false;
        const context = params.context;
        // Check cache with context included
        if (useCache) {
            const cached = squadCache.get(mode, task, context);
            if (cached) {
                return `[Cached result - same request within 5 minutes]\n\n${cached}`;
            }
        }
        // Analyze task and select optimal agents
        let agents;
        let reason;
        if (mode === "creative") {
            agents = [
                "planner",
                "fullstack-developer",
                "frontend-developer",
                "backend-developer",
                "ui-designer",
                "devil-s-advocate",
            ];
            reason = "Creative mode: 6-agent large team (plan+dev+design+DA)";
        }
        else if (/security|vulnerability|auth|token|encrypt/i.test(task)) {
            agents = mode === "review"
                ? ["security-auditor", "code-reviewer", "devil-s-advocate"]
                : ["security-auditor", "devil-s-advocate"];
            reason = "Security task detected";
        }
        else if (/bug|error|debug|fix/i.test(task)) {
            agents = mode === "review"
                ? ["debugger", "code-reviewer", "devil-s-advocate"]
                : ["debugger", "devil-s-advocate"];
            reason = "Debug task detected";
        }
        else if (/implement|develop|create|add|feature/i.test(task)) {
            agents = mode === "fast"
                ? ["planner", "devil-s-advocate"]
                : ["planner", "fullstack-developer", "devil-s-advocate"];
            reason = "Implementation task detected";
        }
        else if (/plan|design|architecture/i.test(task)) {
            agents = ["planner", "devil-s-advocate"];
            reason = "Planning task detected";
        }
        else if (/review|check|analyze/i.test(task)) {
            agents = mode === "fast"
                ? ["code-reviewer", "devil-s-advocate"]
                : ["code-reviewer", "security-auditor", "devil-s-advocate"];
            reason = "Review task detected";
        }
        else {
            agents = mode === "thorough"
                ? ["code-reviewer", "security-auditor", "devil-s-advocate"]
                : ["code-reviewer", "devil-s-advocate"];
            reason = "General task (default review mode)";
        }
        // Validate agent availability
        const { valid, invalid } = validateAgentAvailability(agents);
        if (valid.length === 0) {
            return `Error: No valid agents found. Requested: ${agents.join(", ")}. Available: ${Object.keys(opencodeConfig).join(", ")}`;
        }
        // Cost warning
        const costWarning = estimateAgentCost(valid.length, mode);
        // Create ephemeral team (doesn't persist, but follows same structure)
        const teamId = `squad-${Date.now()}-${randomUUID().slice(0, 8)}`;
        const team = {
            id: teamId,
            name: `squad-${mode}`,
            preset: "custom",
            agents: new Map(),
            createdAt: new Date(),
            lastActivity: new Date(),
            task,
        };
        // Add valid agents
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
        // Build prompt with context
        let taskPrompt = task;
        if (context) {
            taskPrompt = `${task}\n\n## Context:\n${context}`;
        }
        taskPrompt += `\n\n## Output Guide\n- Be concise and focus on key points\n- Provide practical, actionable suggestions`;
        // Separate DA from other agents for second-pass execution
        const nonDAAgents = valid.filter(n => !isDevilsAdvocate(n));
        const hasDA = valid.some(n => isDevilsAdvocate(n));
        // Phase 1: Execute non-DA agents in parallel
        const executeAgentWithRetry = async (agentName) => {
            let retries = 0;
            let success = false;
            let result;
            let error;
            let sessionID;
            let wasTruncated = false;
            try {
                while (!success && retries <= 2) {
                    try {
                        const sessionResult = await spawnAgentSession(agentName, taskPrompt, teamId);
                        if (sessionResult) {
                            sessionID = sessionResult.sessionID;
                            result = await waitForSessionCompletion(sessionID, DEFAULT_TIMEOUT_MS);
                            const { text: truncatedResult, wasTruncated: truncated } = truncateText(result, MAX_RESULT_LENGTH);
                            result = truncatedResult;
                            wasTruncated = truncated;
                            success = true;
                        }
                    }
                    catch (e) {
                        error = e instanceof Error ? e.message : String(e);
                        retries++;
                        if (retries <= 2) {
                            await new Promise(resolve => setTimeout(resolve, 1000 * retries));
                        }
                    }
                }
            }
            finally {
                if (sessionID) {
                    try {
                        await cleanupSession(sessionID);
                    }
                    catch (cleanupError) {
                        const errorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
                        console.warn(`[agent-squad] Failed to cleanup session ${sessionID}: ${errorMessage}`);
                    }
                }
            }
            return { name: agentName, success, result, error, truncated: wasTruncated };
        };
        const executionPromises = nonDAAgents.map(name => executeAgentWithRetry(name));
        const results = await Promise.allSettled(executionPromises);
        const settledResults = results.map((r) => {
            if (r.status === "fulfilled") {
                return r.value;
            }
            return {
                name: r.reason?.name || "unknown",
                success: false,
                error: r.reason instanceof Error ? r.reason.message : String(r.reason)
            };
        });
        // Phase 2: Run DA as second-pass if present
        if (hasDA) {
            const daResult = await runDevilsAdvocateSecondPass(teamId, taskPrompt, DEFAULT_TIMEOUT_MS);
            if (daResult.success) {
                const { text: truncatedResult, wasTruncated } = truncateText(daResult.result, MAX_RESULT_LENGTH);
                daResult.result = truncatedResult;
                daResult.truncated = wasTruncated;
                settledResults.push(daResult);
            }
        }
        // Format results
        let output = `**Squad Execution Complete** (${mode} mode)\n`;
        output += `${reason}\n`;
        if (invalid.length > 0) {
            output += `⚠️ Skipped unavailable agents: ${invalid.join(", ")}\n`;
        }
        output += `Agents: ${valid.join(", ")}\n\n`;
        output += `---\n\n`;
        let truncatedCount = 0;
        for (const r of settledResults) {
            if (r.success && r.result) {
                if (r.truncated)
                    truncatedCount++;
                output += `### ${r.name}\n\n`;
                output += r.result;
                if (r.truncated) {
                    output += `\n\n⚠️ *Result was truncated to ${MAX_RESULT_LENGTH} characters*`;
                }
                output += `\n\n`;
            }
            else if (r.error) {
                output += `### ${r.name}\n\n`;
                output += `**Error**: ${r.error}\n\n`;
            }
        }
        // Summary
        const successCount = settledResults.filter(r => r.success).length;
        output += `---\n`;
        output += `**Result**: ${successCount}/${settledResults.length} agents succeeded\n`;
        if (truncatedCount > 0) {
            output += `⚠️ ${truncatedCount} results were truncated due to length limits.\n`;
        }
        if (successCount === settledResults.length) {
            output += `All agents completed successfully.\n`;
        }
        else if (successCount > 0) {
            output += `Some agents failed. Please review the results.\n`;
        }
        else {
            output += `All agents failed. Please try again.\n`;
        }
        // Cleanup stats
        if (cleanupStats.failed > 0) {
            output += `\n[Cleanup: ${cleanupStats.successful}/${cleanupStats.totalAttempts} successful, ${cleanupStats.failed} failed]\n`;
        }
        // Save to cache
        if (useCache && successCount > 0) {
            squadCache.set(mode, task, output, context);
        }
        // Cleanup ephemeral team
        teams.delete(teamId);
        return output;
    },
});
// ============================================================================
// PLUGIN EXPORT
// ============================================================================
export default async function plugin(input) {
    globalClient = input.client;
    opencodeConfig = loadOpenCodeAgents();
    // Reload persisted teams
    const persistedTeams = loadPersistedTeams();
    for (const [id, team] of persistedTeams) {
        teams.set(id, team);
    }
    return {
        tool: {
            // Core Tools Only (4)
            "squad": squadTool,
            "team-spawn": teamSpawnTool,
            "team-execute": teamExecuteTool,
            "team-discuss": teamDiscussTool,
        },
    };
}
