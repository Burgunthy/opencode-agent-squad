import { tool } from "@opencode-ai/plugin";
import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
const z = tool.schema;
// ============================================================================
// CONSTANTS
// ============================================================================
const MAX_TEAMS = 50;
const MAX_TASKS = 200;
const DEFAULT_TIMEOUT_MS = 90000;
const POLL_INTERVAL_MS = 1500;
const MAX_RESULT_LENGTH = 2000;
const MAX_DISCUSSION_RESULT_LENGTH = 1000;
const MAX_CONTEXT_LENGTH = 500;
const DEFAULT_PRESET = "review";
const DEFAULT_TIMEOUT_SECONDS = 120;
const TEAMS_DIR = path.join(os.homedir(), ".opencode", "teams");
// ============================================================================
// DEVIL'S ADVOCATE PROMPT
// ============================================================================
const DEVILS_ADVOCATE_PROMPT = `
당신은 Devil's Advocate입니다. **모든 분석에 대해 반드시 비판적 관점을 제시해야 합니다.**

## 의무 사항
1. **잠재적 위험 지적**: 모든 제안의 위험성을 식별
2. **대안 제시**: 더 나은 접근법이 있다면 제시
3. **검증되지 않은 가정 식별**: 증명되지 않은 전제를 찾아라
4. **엣지 케이스 발견**: 다른 에이전트가 놓친 시나리오

## 출력 형식
### 🚨 What's Wrong
- [문제점]

### 💡 Alternative Approach
- [대안]

### ⚠️ What Others Missed
- [다른 에이전트가 놓친 것]

반드시 비판적이어야 합니다. 무조건적인 승인은 금지입니다.
`;
// ============================================================================
// KOREAN-OPTIMIZED PROMPTS (차별화 기능 1: 한국어 최적화)
// ============================================================================
const KOREAN_REVIEW_PROMPT = `
당신은 한국어 최적화 코드 리뷰어입니다.

## 역할
- **전문가 수준의 코드 분석**: 한국어로 상세하고 명확한 리뷰 제공
- **구체적 개선 제안**: "이 부분을 고치세요" 대신 "이 부분을 X 방식으로 개선하면 Y 이유로 더 좋습니다"와 같이 구체적으로
- **우선순위 표시**: 🔴 심각한 문제, 🟡 개선 제안, 🔵 스타일 제안

## 출력 형식 (한국어)
### 📋 리뷰 요약
[한 문장 요약]

### 🔴 심각한 문제 (Critical)
- **위치**: 파일:행
- **문제**: [설명]
- **해결방안**: [구체적 코드 수정 제안]

### 🟡 개선 제안 (Improvement)
- **위치**: 파일:행
- **제안**: [설명]
- **이유**: [왜 더 나은지]

### 🔵 스타일 (Style)
- [설명]

### ✅ 장점
- [잘 된 부분 인정]

모든 출력은 한국어로 작성하세요.
`;
const KOREAN_DEBATE_PROMPT = `
당신은 토론 전문가입니다. 건설적인 토론을 이끌어주세요.

## 토론 원칙
1. **논리적 근거**: 모든 주장에 근거 제시
2. **상호 존중**: 타 에이전트 의견 존중
3. **사실 중심**: 개인적 의견보다 사실 위주

## 한국어 토론 형식
### 🎯 내 입장
[한 문장으로 요약]

### 📊 근거
1. [첫 번째 근거]
2. [두 번째 근거]

### 🔄 다른 의견에 대한 답변
[다른 에이전트 의견에 대한 반론/수용]

### 💎 결론
[최종 요약]

모든 출력은 한국어로 작성하세요.
`;
const SUMMARY_BOT_PROMPT = `
당신은 종합 보고서 작성 전문가입니다.

## 역할
모든 에이전트의 의견과 토론을 분석하여, 객관적이고 균형 잡힌 종합 보고서를 작성하세요.

## 보고서 구조 (한국어)
### 📌 결론 요약
[모든 에이전트 합의사항 또는 최종 결론]

### 📊 에이전트별 주요 의견
| 에이전트 | 주장 | 요약 |
|---------|------|------|
| [이름] | [주장] | [한 줄 요약] |

### 🔍 합의된 사항
- [모두가 동의한 사항]

### 💭 논의된 사항 (합의 미달)
- [의견이 나뉜 사항과 각 입장]

### ⚠️ 발견된 위험/문제점
| 위험도 | 문제 | 제안된 해결책 |
|-------|------|-------------|
| [높음/중간/낮음] | [문제] | [해결책] |

### 🎯 다음 단계
1. [구체적 행동 항목 1]
2. [구체적 행동 항목 2]

모든 출력은 한국어로 작성하세요.
`;
// ============================================================================
// VOTING STATE
// ============================================================================
const votingHistory = new Map();
// ============================================================================
// DEVIL'S ADVOCATE AUTO CRITIQUE (차별화 기능 3: 자동 반론 생성)
// ============================================================================
async function generateDevilsAdvocateCritique(targetAgentName, targetResult, team) {
    const daAgent = Array.from(team.agents.values()).find(a => isDevilsAdvocate(a.name));
    if (!daAgent) {
        return "[Devil's Advocate가 팀에 없습니다]";
    }
    const critiquePrompt = `다음은 ${targetAgentName} 에이전트의 분석 결과입니다:

---
${targetResult}
---

## Devil's Advocate 역할
위 분석에 대해 다음 항목들을 반드시 포함하여 비판적 분석을 하세요:

### 🚨 문제점 (What's Wrong)
- 위 분석의 문제점, 논리적 오류, 놓친 부분

### 💡 대안 (Alternative Approach)
- 더 나은 접근법이 있다면 제시

### ⚠️ 다른 에이전트가 놓친 것 (What Others Missed)
- 엣지 케이스, 예외 상황, 고려되지 않은 요소

### 🔍 검증이 필요한 가정
- 증명되지 않은 전제나 가정

반드시 비판적이어야 하며, 무조건적인 승인은 금지입니다.`;
    try {
        const { sessionID } = await spawnAgentSession(daAgent.name, critiquePrompt);
        return await waitForSessionCompletion(sessionID, DEFAULT_TIMEOUT_MS);
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return `[Devil's Advocate 분석 실패: ${errorMessage}]`;
    }
}
// Devil's Advocate 이름 매칭 (여러 변형 지원 + 한국어)
const DEVILS_ADVOCATE_NAMES = [
    "devil-s-advocate",
    "devils-advocate",
    "devil_advocate",
    "devilsadvocate",
    "devil-sadvocate",
    "반론가", // Korean "Devil's Advocate"
    "비판가", // Korean "Critic"
];
function isDevilsAdvocate(agentName) {
    const normalized = agentName.toLowerCase().replace(/[_-]/g, "");
    return DEVILS_ADVOCATE_NAMES.some(name => normalized === name.replace(/[_-]/g, ""));
}
// ============================================================================
// GLOBAL STATE
// ============================================================================
let globalClient = null;
let opencodeConfig = {};
const teams = new Map();
const messageQueue = new Map();
const plans = new Map();
const agentReputations = new Map();
const agentScores = new Map();
const handoffRequests = new Map();
// ============================================================================
// PERSISTENCE
// ============================================================================
function ensureTeamsDir() {
    if (!fs.existsSync(TEAMS_DIR)) {
        fs.mkdirSync(TEAMS_DIR, { recursive: true });
    }
}
function saveTeam(team) {
    try {
        ensureTeamsDir();
        const teamPath = path.join(TEAMS_DIR, `${team.id}.json`);
        const serialized = {
            id: team.id,
            name: team.name,
            preset: team.preset,
            task: team.task,
            createdAt: team.createdAt.toISOString(),
            agents: Array.from(team.agents.entries()).map(([name, agent]) => ({
                name,
                role: agent.role,
                status: agent.status,
                result: agent.result,
                error: agent.error
            })),
            tasks: Array.from(team.tasks.entries()).map(([id, task]) => ({
                id,
                subject: task.subject,
                description: task.description,
                status: task.status,
                owner: task.owner,
                blockedBy: task.blockedBy,
                blocks: task.blocks,
                result: task.result,
                error: task.error,
                createdAt: task.createdAt.toISOString(),
                completedAt: task.completedAt?.toISOString()
            }))
        };
        fs.writeFileSync(teamPath, JSON.stringify(serialized, null, 2));
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`[agent-squad] Failed to save team: ${errorMessage}`);
    }
}
function loadTeam(teamId) {
    try {
        const teamPath = path.join(TEAMS_DIR, `${teamId}.json`);
        if (!fs.existsSync(teamPath))
            return null;
        const data = JSON.parse(fs.readFileSync(teamPath, "utf-8"));
        const team = {
            id: data.id,
            name: data.name,
            preset: data.preset,
            task: data.task,
            createdAt: new Date(data.createdAt),
            agents: new Map(),
            tasks: new Map()
        };
        for (const agent of data.agents || []) {
            team.agents.set(agent.name, {
                name: agent.name,
                sessionID: null,
                role: agent.role,
                status: agent.status,
                result: agent.result,
                error: agent.error
            });
        }
        for (const task of data.tasks || []) {
            team.tasks.set(task.id, {
                id: task.id,
                subject: task.subject,
                description: task.description,
                status: task.status,
                owner: task.owner,
                blockedBy: task.blockedBy || [],
                blocks: task.blocks || [],
                result: task.result,
                error: task.error,
                createdAt: new Date(task.createdAt),
                completedAt: task.completedAt ? new Date(task.completedAt) : undefined
            });
        }
        return team;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`[agent-squad] Failed to load team: ${errorMessage}`);
        return null;
    }
}
// ============================================================================
// PLAN APPROVAL SYSTEM
// ============================================================================
function createPlan(agentId, agentName, content) {
    const plan = {
        id: `plan-${Date.now()}-${randomUUID().slice(0, 8)}`,
        agentId,
        agentName,
        content,
        status: "pending",
        submittedAt: new Date(),
    };
    plans.set(plan.id, plan);
    savePlans();
    return plan;
}
function updatePlanStatus(planId, status, feedback) {
    const plan = plans.get(planId);
    if (!plan)
        return null;
    plan.status = status;
    if (feedback !== undefined) {
        plan.feedback = feedback;
    }
    if (status === "approved" || status === "rejected") {
        plan.reviewedAt = new Date();
    }
    savePlans();
    return plan;
}
function getPendingPlans() {
    return Array.from(plans.values()).filter(p => p.status === "pending");
}
function getPlan(planId) {
    return plans.get(planId) ?? null;
}
function getPlansByAgent(agentId) {
    return Array.from(plans.values()).filter(p => p.agentId === agentId);
}
// Plan persistence
const PLANS_FILE = path.join(TEAMS_DIR, "plans.json");
function savePlans() {
    try {
        ensureTeamsDir();
        const serialized = Array.from(plans.entries()).map(([id, plan]) => ({
            id,
            agentId: plan.agentId,
            agentName: plan.agentName,
            content: plan.content,
            status: plan.status,
            feedback: plan.feedback,
            submittedAt: plan.submittedAt.toISOString(),
            reviewedAt: plan.reviewedAt?.toISOString(),
        }));
        fs.writeFileSync(PLANS_FILE, JSON.stringify(serialized, null, 2));
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`[agent-squad] Failed to save plans: ${errorMessage}`);
    }
}
function loadPlans() {
    try {
        if (!fs.existsSync(PLANS_FILE))
            return;
        const data = JSON.parse(fs.readFileSync(PLANS_FILE, "utf-8"));
        for (const item of data) {
            const plan = {
                id: item.id,
                agentId: item.agentId,
                agentName: item.agentName,
                content: item.content,
                status: item.status,
                feedback: item.feedback,
                submittedAt: new Date(item.submittedAt),
                reviewedAt: item.reviewedAt ? new Date(item.reviewedAt) : undefined,
            };
            plans.set(plan.id, plan);
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`[agent-squad] Failed to load plans: ${errorMessage}`);
    }
}
// ============================================================================
// REPUTATION SYSTEM
// ============================================================================
const REPUTATION_FILE = path.join(TEAMS_DIR, "reputations.json");
const SCORES_FILE = path.join(TEAMS_DIR, "scores.json");
function getAgentReputation(agentName) {
    let reputation = agentReputations.get(agentName);
    if (!reputation) {
        reputation = {
            totalTasks: 0,
            successfulTasks: 0,
            averageScore: 0,
            lastUpdated: new Date(),
        };
        agentReputations.set(agentName, reputation);
    }
    return reputation;
}
function updateAgentReputation(agentName, success, score) {
    const reputation = getAgentReputation(agentName);
    reputation.totalTasks++;
    if (success) {
        reputation.successfulTasks++;
    }
    if (score !== undefined) {
        // 새 평균 = (기존 평균 * 기존 작업 수 + 새 점수) / 총 작업 수
        const scoredTasks = reputation.averageScore > 0
            ? reputation.totalTasks - 1
            : 0;
        reputation.averageScore = scoredTasks > 0
            ? (reputation.averageScore * scoredTasks + score) / (scoredTasks + 1)
            : score;
    }
    reputation.lastUpdated = new Date();
    saveReputations();
}
function addAgentScore(agentName, score, feedback, scoredBy) {
    const agentScore = {
        agentName,
        score,
        feedback,
        scoredBy,
        timestamp: new Date(),
    };
    const scores = agentScores.get(agentName) || [];
    scores.push(agentScore);
    agentScores.set(agentName, scores);
    updateAgentReputation(agentName, true, score);
    saveScores();
}
function getAgentScores(agentName) {
    return agentScores.get(agentName) || [];
}
function formatReputation(agentName) {
    const reputation = getAgentReputation(agentName);
    const successRate = reputation.totalTasks > 0
        ? ((reputation.successfulTasks / reputation.totalTasks) * 100).toFixed(1)
        : "N/A";
    return `[성공률: ${successRate}% (${reputation.successfulTasks}/${reputation.totalTasks}), 평균점수: ${reputation.averageScore.toFixed(1)}]`;
}
function saveReputations() {
    try {
        ensureTeamsDir();
        const serialized = Array.from(agentReputations.entries());
        fs.writeFileSync(REPUTATION_FILE, JSON.stringify(serialized, null, 2));
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`[agent-squad] Failed to save reputations: ${errorMessage}`);
    }
}
function loadReputations() {
    try {
        if (!fs.existsSync(REPUTATION_FILE))
            return;
        const data = JSON.parse(fs.readFileSync(REPUTATION_FILE, "utf-8"));
        for (const [name, rep] of data) {
            agentReputations.set(name, {
                totalTasks: rep.totalTasks,
                successfulTasks: rep.successfulTasks,
                averageScore: rep.averageScore,
                lastUpdated: new Date(rep.lastUpdated),
            });
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`[agent-squad] Failed to load reputations: ${errorMessage}`);
    }
}
function saveScores() {
    try {
        ensureTeamsDir();
        const serialized = Array.from(agentScores.entries()).map(([agentName, scores]) => [
            agentName,
            scores.map(s => ({
                ...s,
                timestamp: s.timestamp.toISOString(),
            })),
        ]);
        fs.writeFileSync(SCORES_FILE, JSON.stringify(serialized, null, 2));
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`[agent-squad] Failed to save scores: ${errorMessage}`);
    }
}
function loadScores() {
    try {
        if (!fs.existsSync(SCORES_FILE))
            return;
        const data = JSON.parse(fs.readFileSync(SCORES_FILE, "utf-8"));
        for (const [agentName, scores] of data) {
            agentScores.set(agentName, scores.map((s) => ({
                ...s,
                timestamp: new Date(s.timestamp),
            })));
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`[agent-squad] Failed to load scores: ${errorMessage}`);
    }
}
const conflicts = new Map();
function detectConflict(teamId, results) {
    const agents = Array.from(results.keys());
    if (agents.length < 2)
        return null;
    // 간단한 충돌 감지: 결과가 서로 다른 에이전트가 다른 결론에 도달
    const values = Array.from(results.values());
    const uniqueValues = new Set(values);
    if (uniqueValues.size > 1) {
        return {
            topic: "Analysis disagreement",
            agents,
            positions: values,
            timestamp: new Date(),
        };
    }
    return null;
}
function resolveConflict(conflict) {
    let resolution = `## 충돌 해결 토론\n\n`;
    resolution += `**주제**: ${conflict.topic}\n`;
    resolution += `**참여 에이전트**: ${conflict.agents.join(", ")}\n\n`;
    resolution += `### 각 에이전트 입장\n`;
    conflict.agents.forEach((agent, i) => {
        resolution += `**${agent}**: ${conflict.positions[i]}\n`;
    });
    resolution += `\n### 해결 방안\n`;
    resolution += `1. 각 입장의 장단점 분석\n`;
    resolution += `2. 공통점 찾기\n`;
    resolution += `3. 통합 솔루션 제안\n`;
    resolution += `4. Devil's Advocate 최종 검토\n\n`;
    return resolution;
}
// ============================================================================
// MESSAGE PROTOCOL
// ============================================================================
/**
 * SendMessage 구현 - 에이전트 간 메시지 교환
 * @param message 전송할 메시지
 */
function sendMessage(message) {
    // 팀별 메시지 큐 키 생성
    const baseKey = message.recipient || "broadcast";
    const key = message.teamId ? `${message.teamId}:${baseKey}` : baseKey;
    const queue = messageQueue.get(key) || [];
    queue.push(message);
    messageQueue.set(key, queue);
    // 브로드캐스트 메시지는 팀 브로드캐스트 큐에도 저장
    if (message.type === "broadcast" && message.teamId) {
        const broadcastKey = `${message.teamId}:broadcast`;
        const broadcastQueue = messageQueue.get(broadcastKey) || [];
        broadcastQueue.push(message);
        messageQueue.set(broadcastKey, broadcastQueue);
    }
}
/**
 * 에이전트 실행 결과를 팀원들에게 방송
 * @param teamId 팀 ID
 * @param senderName 발신자 에이전트 이름
 * @param result 실행 결과
 * @param success 성공 여부
 */
function broadcastAgentResult(teamId, senderName, result, success) {
    const summary = success && result
        ? `Completed: ${result.slice(0, 100)}...`
        : `Failed: ${senderName} encountered an error`;
    sendMessage({
        type: "broadcast",
        sender: senderName,
        content: result || "No result",
        summary,
        timestamp: new Date(),
        teamId,
    });
}
/**
 * 특정 에이전트에게 메시지 전송 (DM)
 * @param teamId 팀 ID
 * @param senderName 발신자
 * @param recipientName 수신자
 * @param content 메시지 내용
 */
function sendDirectMessage(teamId, senderName, recipientName, content) {
    sendMessage({
        type: "message",
        sender: senderName,
        recipient: recipientName,
        content,
        summary: content.slice(0, 50),
        timestamp: new Date(),
        teamId,
    });
}
/**
 * 팀 메시지 가져오기
 * @param teamId 팀 ID
 * @param recipient 수신자 (broadcast 포함)
 * @param since 이후 시간부터의 메시지만
 */
function getTeamMessages(teamId, recipient = "broadcast", since) {
    const key = `${teamId}:${recipient}`;
    const queue = messageQueue.get(key) || [];
    // 브로드캐스트 메시지도 포함
    let all = queue;
    if (recipient !== "broadcast") {
        const broadcastKey = `${teamId}:broadcast`;
        const broadcast = messageQueue.get(broadcastKey) || [];
        all = [...queue, ...broadcast];
    }
    if (since) {
        return all.filter(m => m.timestamp > since);
    }
    return all;
}
/**
 * 에이전트 간 컨텍스트 형식화 (프롬프트용)
 * @param teamId 팀 ID
 * @param excludeAgent 제외할 에이전트 이름
 */
function formatAgentContext(teamId, excludeAgent) {
    const messages = getTeamMessages(teamId, "broadcast");
    if (messages.length === 0) {
        return "(다른 에이전트의 결과가 아직 없습니다)";
    }
    const filtered = excludeAgent
        ? messages.filter(m => m.sender !== excludeAgent)
        : messages;
    if (filtered.length === 0) {
        return "(다른 에이전트의 결과가 아직 없습니다)";
    }
    return filtered
        .map(m => `### ${m.sender}:\n${m.summary || m.content.slice(0, 300)}`)
        .join("\n\n");
}
/**
 * 팀 메시지 큐 정리
 * @param teamId 팀 ID
 */
function clearTeamMessages(teamId) {
    const keysToDelete = [];
    for (const [key] of messageQueue) {
        if (key.startsWith(`${teamId}:`)) {
            keysToDelete.push(key);
        }
    }
    for (const key of keysToDelete) {
        messageQueue.delete(key);
    }
}
// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const truncateText = (text, maxLength) => text.length > maxLength ? text.slice(0, maxLength) + "..." : text;
const extractRoleFromDescription = (description, fallback) => description?.split(".")[0] ?? fallback;
// ============================================================================
// OPENCODE CLIENT & CONFIG
// ============================================================================
function loadOpenCodeAgents() {
    try {
        const configPath = path.join(process.cwd(), "opencode.json");
        const configContent = fs.readFileSync(configPath, "utf-8");
        const config = JSON.parse(configContent);
        opencodeConfig = config.agent ?? {};
        return opencodeConfig;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`[agent-squad] Failed to load opencode.json: ${errorMessage}`);
        return {};
    }
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
    // Devil's Advocate면 강제 프롬프트 적용
    const isDA = isDevilsAdvocate(agentName);
    const basePrompt = agentConfig?.prompt_append || "";
    // 한국어 프리셋 감지 및 프롬프트 적용 (차별화 기능 1)
    let koreanPromptAddon = "";
    if (teamId) {
        const team = teams.get(teamId);
        if (team) {
            if (team.preset === "korean-review") {
                koreanPromptAddon = KOREAN_REVIEW_PROMPT;
            }
            else if (team.preset === "korean-debate" || team.preset === "debate") {
                koreanPromptAddon = KOREAN_DEBATE_PROMPT;
            }
        }
    }
    // 시스템 프롬프트 구성
    const effectiveSystemPrompt = isDA
        ? basePrompt + "\n\n" + DEVILS_ADVOCATE_PROMPT
        : koreanPromptAddon
            ? basePrompt + "\n\n" + koreanPromptAddon
            : basePrompt;
    // SendMessage: 다른 에이전트의 결과를 컨텍스트에 추가
    let fullTask = task;
    if (teamId) {
        const agentContext = formatAgentContext(teamId, agentName);
        if (agentContext && !agentContext.includes("아직 없습니다")) {
            fullTask = `${task}\n\n## 다른 팀원들의 결과:\n${agentContext}\n\n이 정보를 고려하여 작업을 수행하세요.`;
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
    // TextPart 타입 가드
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
    try {
        await globalClient.session.delete({ path: { id: sessionID } });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`[agent-squad] Failed to cleanup session ${sessionID}: ${errorMessage}`);
    }
}
// ============================================================================
// TEAM MANAGEMENT
// ============================================================================
function enforceMaxTeams() {
    if (teams.size <= MAX_TEAMS)
        return;
    const entries = Array.from(teams.entries());
    entries.sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime());
    const toRemove = entries.slice(0, teams.size - MAX_TEAMS);
    for (const [id, team] of toRemove) {
        for (const agent of team.agents.values()) {
            if (agent.sessionID) {
                cleanupSession(agent.sessionID).catch(() => { });
            }
        }
        teams.delete(id);
    }
}
// ============================================================================
// TASK MANAGEMENT
// ============================================================================
function createTask(team, subject, description, owner, blockedBy = [], blocks = []) {
    const task = {
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        subject,
        description,
        status: "pending",
        owner,
        blockedBy,
        blocks,
        createdAt: new Date()
    };
    team.tasks.set(task.id, task);
    // Enforce max tasks
    if (team.tasks.size > MAX_TASKS) {
        const sorted = Array.from(team.tasks.entries())
            .sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime());
        const toRemove = sorted.slice(0, team.tasks.size - MAX_TASKS);
        for (const [id] of toRemove) {
            team.tasks.delete(id);
        }
    }
    saveTeam(team);
    return task;
}
function canExecuteTask(team, task) {
    return task.blockedBy.every(depId => {
        const depTask = team.tasks.get(depId);
        return depTask?.status === "completed";
    });
}
function getExecutableTasks(team) {
    return Array.from(team.tasks.values())
        .filter(t => t.status === "pending" && canExecuteTask(team, t));
}
// 순환 의존성 감지
function detectCyclicDependency(team, taskId, visited = new Set()) {
    if (visited.has(taskId))
        return true;
    visited.add(taskId);
    const task = team.tasks.get(taskId);
    if (!task)
        return false;
    for (const depId of task.blockedBy) {
        if (detectCyclicDependency(team, depId, visited)) {
            return true;
        }
    }
    visited.delete(taskId);
    return false;
}
// 모든 순환 의존성 감지
function findCyclicDependencies(team) {
    const cyclic = [];
    for (const [id] of team.tasks) {
        if (detectCyclicDependency(team, id)) {
            cyclic.push(id);
        }
    }
    return cyclic;
}
/**
 * 에이전트 실행 함수 - SendMessage 프로토콜 지원
 * @param name 에이전트 이름
 * @param agent 에이전트 객체
 * @param task 작업 내용
 * @param timeout 타임아웃(ms)
 * @param teamId 팀 ID (메시지 방송용)
 */
async function executeAgent(name, agent, task, timeout, teamId) {
    agent.status = "thinking";
    try {
        const prompt = `${task}\n\n당신은 ${name}(${agent.role}) 역할입니다. 전문성으로 작업을 수행해주세요.`;
        const { sessionID } = await spawnAgentSession(name, prompt, teamId);
        agent.sessionID = sessionID;
        agent.status = "responding";
        const result = await waitForSessionCompletion(sessionID, timeout);
        agent.status = "completed";
        agent.result = result;
        // Reputation: 에이전트 평판 업데이트
        updateAgentReputation(name, true);
        // SendMessage: 팀원들에게 결과 방송
        if (teamId) {
            broadcastAgentResult(teamId, name, result, true);
        }
        return { name, success: true, result };
    }
    catch (error) {
        agent.status = "error";
        agent.error = error instanceof Error ? error.message : String(error);
        // Reputation: 실패도 기록
        updateAgentReputation(name, false);
        // SendMessage: 실패 메시지도 방송
        if (teamId) {
            broadcastAgentResult(teamId, name, agent.error, false);
        }
        return { name, success: false, error: agent.error };
    }
}
function formatExecutionResults(team, results) {
    let response = `---\n\n## Results\n\n`;
    for (const { name, success, result, error } of results) {
        const agent = team.agents.get(name);
        const reputation = formatReputation(name);
        const statusIcon = success ? "[OK]" : "[FAIL]";
        response += `### ${statusIcon} ${name} ${reputation}\n`;
        response += `**Status**: ${agent?.status ?? "unknown"}\n`;
        if (success && result) {
            response += `\n${truncateText(result, MAX_RESULT_LENGTH)}\n`;
        }
        else if (error) {
            response += `**Error**: ${error}\n`;
        }
        response += `\n---\n\n`;
    }
    return response;
}
// ============================================================================
// PRESETS
// ============================================================================
const PRESETS = {
    review: ["code-reviewer", "security-auditor", "devil-s-advocate"],
    security: ["security-auditor", "devil-s-advocate"],
    debug: ["debugger", "devil-s-advocate"],
    planning: ["planner", "devil-s-advocate"],
    implementation: [
        "backend-developer",
        "frontend-developer",
        "test-automator",
        "devil-s-advocate",
    ],
    fullstack: ["fullstack-developer", "devil-s-advocate"],
    research: ["explore", "data-scientist", "devil-s-advocate"],
    ai: ["ai-engineer", "llm-architect", "prompt-engineer", "devil-s-advocate"],
    // Korean-optimized presets (차별화 기능 1)
    "korean-review": ["code-reviewer", "devil-s-advocate"],
    "korean-debate": ["planner", "devil-s-advocate"],
    debate: ["planner", "devil-s-advocate", "security-auditor"],
};
const PRESET_KEYWORDS = {
    security: ["security", "보안", "취약점"],
    debug: ["debug", "버그", "에러"],
    planning: ["planning", "계획", "설계"],
    implementation: ["implement", "구현", "개발"],
    research: ["research", "조사", "탐색"],
    // Korean keywords (차별화 기능 1)
    "korean-review": ["한국어", "korean", "리뷰"],
    "korean-debate": ["토론", "debate", "한국어"],
    debate: ["토론", "debate", "논의"],
};
function detectPreset(request) {
    const lowerRequest = request.toLowerCase();
    for (const [preset, keywords] of Object.entries(PRESET_KEYWORDS)) {
        if (keywords.some((kw) => lowerRequest.includes(kw))) {
            return preset;
        }
    }
    return DEFAULT_PRESET;
}
// ============================================================================
// TOOLS
// ============================================================================
const teamSpawnTool = tool({
    description: "Spawn a real agent team with actual OpenCode subagents",
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
        // 입력 검증
        if (!args.teamName || args.teamName.trim() === "") {
            return `Error: Team name is required`;
        }
        if (!args.task || args.task.trim() === "") {
            return `Error: Task description is required`;
        }
        const presetValue = args.preset ?? DEFAULT_PRESET;
        const teamId = `team-${Date.now()}-${randomUUID().slice(0, 8)}`;
        const availableAgents = loadOpenCodeAgents();
        const agentNames = PRESETS[presetValue] ??
            presetValue.split(",").map((s) => s.trim()).filter(Boolean);
        if (agentNames.length === 0) {
            return `Error: No agents specified. Available: ${Object.keys(availableAgents).join(", ")}`;
        }
        const team = {
            id: teamId,
            name: args.teamName,
            preset: presetValue,
            agents: new Map(),
            tasks: new Map(),
            createdAt: new Date(),
            task: args.task,
        };
        const missingAgents = [];
        for (const name of agentNames) {
            const agentDef = availableAgents[name];
            if (!agentDef) {
                missingAgents.push(name);
            }
            team.agents.set(name, {
                name,
                sessionID: null,
                role: extractRoleFromDescription(agentDef?.description, name),
                status: "idle",
            });
        }
        teams.set(teamId, team);
        enforceMaxTeams();
        let response = `## Team "${args.teamName}" Created\n\n`;
        response += `**Team ID**: ${teamId}\n`;
        response += `**Preset**: ${presetValue}\n`;
        response += `**Agents**: ${team.agents.size}\n\n`;
        response += `### Agents\n`;
        for (const [name, agent] of team.agents) {
            const defined = availableAgents[name] ? "[OK]" : "[WARN] (not in config)";
            response += `- **${name}** (${agent.role}) ${defined}\n`;
        }
        if (missingAgents.length > 0) {
            response += `\n[WARN] **Warning**: Not in opencode.json: ${missingAgents.join(", ")}\n`;
        }
        response += `\n### Task\n${args.task}\n`;
        response += `\n---\n`;
        response += `Use \`/team-execute teamId="${teamId}"\` to run.\n`;
        return response;
    },
});
const teamExecuteTool = tool({
    description: "Execute team agents in parallel and collect results with SendMessage protocol",
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
            return `Error: Team ${args.teamId} not found`;
        }
        // Initialize tasks if needed
        if (!team.tasks) {
            team.tasks = new Map();
        }
        const timeout = (args.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
        team.results = new Map();
        // 팀 메시지 큐 정리
        clearTeamMessages(args.teamId);
        let response = `## Executing Team "${team.name}"\n\n`;
        response += `**Task**: ${team.task}\n`;
        response += `**Agents**: ${team.agents.size}\n\n`;
        // SendMessage 프로토콜 사용: teamId 전달
        const executionPromises = Array.from(team.agents.entries()).map(([name, agent]) => executeAgent(name, agent, team.task, timeout, args.teamId));
        const results = await Promise.allSettled(executionPromises);
        const settledResults = results.map((r, index) => {
            const agentName = Array.from(team.agents.keys())[index];
            if (r.status === "fulfilled") {
                return r.value;
            }
            return {
                name: agentName,
                success: false,
                error: r.reason instanceof Error ? r.reason.message : String(r.reason),
            };
        });
        // 결과 저장
        for (const result of settledResults) {
            if (result.success && result.result) {
                team.results.set(result.name, result.result);
            }
        }
        response += formatExecutionResults(team, settledResults);
        return response;
    },
});
const teamDiscussTool = tool({
    description: "Run a discussion between team agents with context sharing via SendMessage protocol",
    args: {
        teamId: z.string().describe("Team ID"),
        topic: z.string().describe("Discussion topic"),
        rounds: z.number().optional().describe("Number of rounds (default: 2, max: 3)"),
    },
    async execute(args) {
        if (!globalClient) {
            return "Error: OpenCode client not available";
        }
        // 입력 검증
        if (!args.teamId || args.teamId.trim() === "") {
            return `Error: Team ID is required`;
        }
        if (!args.topic || args.topic.trim() === "") {
            return `Error: Discussion topic is required`;
        }
        const team = teams.get(args.teamId);
        if (!team) {
            return `Error: Team ${args.teamId} not found`;
        }
        const rounds = Math.min(Math.max(args.rounds ?? 2, 1), 3);
        let response = `## Discussion: ${truncateText(args.topic, 100)}\n\n`;
        response += `**Team**: ${team.name}\n`;
        response += `**Rounds**: ${rounds}\n\n`;
        // 팀 메시지 큐 정리 (새 토론 시작)
        clearTeamMessages(args.teamId);
        for (let r = 1; r <= rounds; r++) {
            response += `### Round ${r}\n\n`;
            for (const [name, agent] of team.agents) {
                // SendMessage 프로토콜을 사용한 컨텍스트 수집
                const agentContext = formatAgentContext(args.teamId, name);
                const prompt = r === 1
                    ? `${args.topic}\n\n당신은 ${name} 역할입니다. 분석해주세요.`
                    : `${args.topic}\n\n## 다른 에이전트 의견:\n${agentContext}\n\n## 추가 분석:\n${name}으로서 새로운 관점이나 반론을 제시하세요. 다른 에이전트가 놓친 점을 찾아주세요.`;
                try {
                    agent.status = "thinking";
                    const { sessionID } = await spawnAgentSession(name, prompt);
                    agent.sessionID = sessionID;
                    agent.status = "responding";
                    const result = await waitForSessionCompletion(sessionID, DEFAULT_TIMEOUT_MS);
                    agent.status = "completed";
                    agent.result = result;
                    // SendMessage: 결과를 팀원들에게 방송
                    broadcastAgentResult(args.teamId, name, result, true);
                    response += `**${name}**:\n`;
                    response += `${truncateText(result, MAX_DISCUSSION_RESULT_LENGTH)}\n\n`;
                }
                catch (error) {
                    agent.status = "error";
                    agent.error = error instanceof Error ? error.message : String(error);
                    // SendMessage: 실패 메시지도 방송
                    broadcastAgentResult(args.teamId, name, agent.error, false);
                    response += `**${name}**: [FAIL] Error - ${agent.error}\n\n`;
                }
            }
        }
        response += `---\n**Team ID**: ${team.id}`;
        return response;
    },
});
const teamStatusTool = tool({
    description: "Check team status and results",
    args: {
        teamId: z.string().optional().describe("Team ID (omit to list all)"),
    },
    async execute(args) {
        if (!args.teamId) {
            if (teams.size === 0) {
                return "No active teams. Use `/team-spawn` to create one.";
            }
            let r = `## Active Teams (${teams.size})\n\n`;
            for (const [id, t] of teams) {
                const completed = Array.from(t.agents.values()).filter((a) => a.status === "completed").length;
                r += `- **${t.name}** (${id})\n`;
                r += `  - Preset: ${t.preset}\n`;
                r += `  - Progress: ${completed}/${t.agents.size}\n\n`;
            }
            return r;
        }
        const team = teams.get(args.teamId);
        if (!team) {
            return `Error: Team ${args.teamId} not found`;
        }
        let r = `## ${team.name}\n\n`;
        r += `**Team ID**: ${team.id}\n`;
        r += `**Preset**: ${team.preset}\n`;
        r += `**Task**: ${team.task}\n\n`;
        r += `### Agents\n`;
        const statusIcons = {
            idle: "[ ]",
            thinking: "[*]",
            responding: "[>]",
            completed: "[OK]",
            error: "[!]",
        };
        for (const [n, a] of team.agents) {
            r += `- ${statusIcons[a.status]} **${n}**: ${a.status}\n`;
            if (a.sessionID)
                r += `  - Session: ${a.sessionID}\n`;
            if (a.error)
                r += `  - Error: ${a.error}\n`;
        }
        if (team.tasks && team.tasks.size > 0) {
            r += `\n### Tasks (${team.tasks.size})\n`;
            const pending = Array.from(team.tasks.values()).filter(t => t.status === "pending").length;
            const completed = Array.from(team.tasks.values()).filter(t => t.status === "completed").length;
            const blocked = Array.from(team.tasks.values()).filter(t => t.status === "blocked").length;
            r += `- Pending: ${pending}\n`;
            r += `- Completed: ${completed}\n`;
            r += `- Blocked: ${blocked}\n`;
        }
        return r;
    },
});
const teamShutdownTool = tool({
    description: "Shutdown team and cleanup sessions",
    args: {
        teamId: z.string().describe("Team ID to shutdown"),
    },
    async execute(args) {
        const team = teams.get(args.teamId);
        if (!team) {
            return `Error: Team ${args.teamId} not found`;
        }
        // Cleanup all sessions
        const cleanupPromises = [];
        for (const agent of team.agents.values()) {
            if (agent.sessionID) {
                cleanupPromises.push(cleanupSession(agent.sessionID));
            }
        }
        await Promise.allSettled(cleanupPromises);
        const name = team.name;
        teams.delete(args.teamId);
        return `Team "${name}" shut down.`;
    },
});
const teamAutoTool = tool({
    description: "Natural language team request with auto preset detection, parallel execution, and discussion via SendMessage protocol",
    args: {
        request: z.string().describe("Natural language request"),
        rounds: z.number().optional().describe("Discussion rounds (default: 2, max: 3)"),
    },
    async execute(args) {
        if (!globalClient) {
            return "Error: OpenCode client not available";
        }
        // 입력 검증
        if (!args.request || args.request.trim() === "") {
            return `Error: Request is required`;
        }
        const preset = detectPreset(args.request);
        const teamId = `team-${Date.now()}-${randomUUID().slice(0, 8)}`;
        const agentNames = PRESETS[preset] ?? PRESETS[DEFAULT_PRESET];
        const availableAgents = loadOpenCodeAgents();
        const rounds = Math.min(Math.max(args.rounds ?? 2, 1), 3);
        const team = {
            id: teamId,
            name: `auto-${preset}`,
            preset,
            agents: new Map(),
            tasks: new Map(),
            createdAt: new Date(),
            task: args.request,
        };
        for (const name of agentNames) {
            team.agents.set(name, {
                name,
                sessionID: null,
                role: extractRoleFromDescription(availableAgents[name]?.description, name),
                status: "idle",
            });
        }
        teams.set(teamId, team);
        enforceMaxTeams();
        saveTeam(team);
        let r = `## Auto Team Created\n\n`;
        r += `**Detected Preset**: ${preset}\n`;
        r += `**Team ID**: ${teamId}\n`;
        r += `**Rounds**: ${rounds}\n\n`;
        r += `### Members\n`;
        for (const [n, a] of team.agents) {
            const isDA = isDevilsAdvocate(n) ? " [DEVIL]" : "";
            r += `- **${n}** (${a.role})${isDA}\n`;
        }
        r += `\n### Task\n${args.request}\n\n`;
        r += `---\n\n`;
        // 라운드별 실행
        for (let round = 1; round <= rounds; round++) {
            r += `## Round ${round}\n\n`;
            if (round === 1) {
                // 라운드 1: 병렬 실행 (SendMessage 프로토콜 사용)
                r += `*병렬 분석*\n\n`;
                const executionPromises = Array.from(team.agents.entries()).map(([name, agent]) => executeAgent(name, agent, args.request, DEFAULT_TIMEOUT_SECONDS * 1000, teamId));
                const results = await Promise.allSettled(executionPromises);
                const settledResults = results.map((res, index) => {
                    const agentName = Array.from(team.agents.keys())[index];
                    if (res.status === "fulfilled") {
                        return res.value;
                    }
                    return {
                        name: agentName,
                        success: false,
                        error: res.reason instanceof Error ? res.reason.message : String(res.reason),
                    };
                });
                // 결과 저장
                for (const { name, success, result, error } of settledResults) {
                    const statusIcon = success ? "[OK]" : "[FAIL]";
                    r += `### ${statusIcon} ${name}\n`;
                    if (success && result) {
                        r += `${truncateText(result, MAX_RESULT_LENGTH)}\n`;
                    }
                    else if (error) {
                        r += `**Error**: ${error}\n`;
                    }
                    r += `\n`;
                }
                team.results = new Map(settledResults
                    .filter((res) => res.success && res.result !== undefined)
                    .map((res) => [res.name, res.result]));
            }
            else {
                // 라운드 2+: 순차 토론 (SendMessage 프로토콜로 컨텍스트 공유)
                r += `*토론 (다른 에이전트 결과 공유)*\n\n`;
                for (const [name, agent] of team.agents) {
                    // SendMessage 프로토콜을 사용한 컨텍스트 수집
                    const agentContext = formatAgentContext(teamId, name);
                    const discussPrompt = `${args.request}

## 다른 에이전트 분석 결과:
${agentContext || "(아직 없음)"}

## 당신의 추가 분석:
이전 분석을 바탕으로 새로운 관점이나 반론을 제시하세요. 중복을 피하고, 다른 에이전트가 놓친 점을 찾으세요.`;
                    try {
                        agent.status = "thinking";
                        const { sessionID } = await spawnAgentSession(name, discussPrompt);
                        agent.sessionID = sessionID;
                        agent.status = "responding";
                        const result = await waitForSessionCompletion(sessionID, DEFAULT_TIMEOUT_MS);
                        agent.status = "completed";
                        agent.result = result;
                        // SendMessage: 결과를 팀원들에게 방송
                        broadcastAgentResult(teamId, name, result, true);
                        r += `**${name}**:\n${truncateText(result, MAX_DISCUSSION_RESULT_LENGTH)}\n\n`;
                        // 컨텍스트 업데이트
                        if (team.results) {
                            team.results.set(name, result);
                        }
                    }
                    catch (error) {
                        agent.status = "error";
                        agent.error = error instanceof Error ? error.message : String(error);
                        // SendMessage: 실패 메시지도 방송
                        broadcastAgentResult(teamId, name, agent.error, false);
                        r += `**${name}**: [FAIL] ${agent.error}\n\n`;
                    }
                }
            }
            r += `---\n\n`;
        }
        saveTeam(team);
        r += `**Team ID**: ${teamId}`;
        return r;
    },
});
// ============================================================================
// TASK TOOLS
// ============================================================================
const taskCreateTool = tool({
    description: "Create a task in a team with optional dependencies",
    args: {
        teamId: z.string().describe("Team ID"),
        subject: z.string().describe("Task subject"),
        description: z.string().describe("Task description"),
        owner: z.string().optional().describe("Agent assigned to this task"),
        blockedBy: z.string().optional().describe("Comma-separated task IDs this depends on")
    },
    async execute(args) {
        // 입력 검증
        if (!args.teamId || args.teamId.trim() === "") {
            return `Error: Team ID is required`;
        }
        if (!args.subject || args.subject.trim() === "") {
            return `Error: Task subject is required`;
        }
        if (!args.description || args.description.trim() === "") {
            return `Error: Task description is required`;
        }
        const team = teams.get(args.teamId);
        if (!team) {
            return `Error: Team ${args.teamId} not found`;
        }
        // Initialize tasks map if needed
        if (!team.tasks) {
            team.tasks = new Map();
        }
        const blockedBy = args.blockedBy
            ? args.blockedBy.split(",").map(s => s.trim()).filter(Boolean)
            : [];
        const task = createTask(team, args.subject, args.description, args.owner, blockedBy, []);
        // Update blocked tasks' blocks array
        for (const depId of blockedBy) {
            const depTask = team.tasks.get(depId);
            if (depTask && !depTask.blocks.includes(task.id)) {
                depTask.blocks.push(task.id);
            }
        }
        // 순환 의존성 감지
        if (detectCyclicDependency(team, task.id)) {
            // 롤백: 태스크 삭제
            team.tasks.delete(task.id);
            for (const depId of blockedBy) {
                const depTask = team.tasks.get(depId);
                if (depTask) {
                    depTask.blocks = depTask.blocks.filter(id => id !== task.id);
                }
            }
            return `Error: Creating this task would cause a cyclic dependency. Task not created.`;
        }
        saveTeam(team);
        let response = `## Task Created\n\n`;
        response += `**Task ID**: ${task.id}\n`;
        response += `**Subject**: ${task.subject}\n`;
        response += `**Owner**: ${task.owner || "Unassigned"}\n`;
        response += `**Status**: ${task.status}\n`;
        if (task.blockedBy.length > 0) {
            response += `**Blocked By**: ${task.blockedBy.join(", ")}\n`;
        }
        return response;
    }
});
const taskExecuteTool = tool({
    description: "Execute tasks respecting dependencies (blocks/blockedBy)",
    args: {
        teamId: z.string().describe("Team ID"),
        timeout: z.number().optional().describe("Timeout per task in seconds")
    },
    async execute(args) {
        if (!globalClient) {
            return "Error: OpenCode client not available";
        }
        const team = teams.get(args.teamId);
        if (!team) {
            return `Error: Team ${args.teamId} not found`;
        }
        if (!team.tasks || team.tasks.size === 0) {
            return "No tasks to execute. Use `/task-create` to add tasks.";
        }
        // 순환 의존성 감지
        const cyclicDeps = findCyclicDependencies(team);
        if (cyclicDeps.length > 0) {
            return `Error: Cyclic dependencies detected in tasks: ${cyclicDeps.join(", ")}`;
        }
        const timeout = (args.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
        let response = `## Executing Tasks\n\n`;
        let executable = getExecutableTasks(team);
        let totalCompleted = 0;
        let totalFailed = 0;
        const maxIterations = team.tasks.size * 2;
        let iterations = 0;
        while (executable.length > 0 && iterations < maxIterations) {
            iterations++;
            for (const task of executable) {
                task.status = "in_progress";
                response += `### ${task.subject} (${task.id})\n`;
                if (task.owner && team.agents.has(task.owner)) {
                    const agent = team.agents.get(task.owner);
                    const result = await executeAgent(task.owner, agent, task.description, timeout);
                    if (result.success) {
                        task.status = "completed";
                        task.result = result.result;
                        task.completedAt = new Date();
                        totalCompleted++;
                        response += `**[OK]** Completed\n`;
                    }
                    else {
                        task.status = "error";
                        task.error = result.error;
                        totalFailed++;
                        response += `**[FAIL]** Error: ${result.error}\n`;
                    }
                }
                else {
                    task.status = "completed";
                    task.completedAt = new Date();
                    totalCompleted++;
                    response += `**[OK]** Marked complete (no owner)\n`;
                }
            }
            saveTeam(team);
            executable = getExecutableTasks(team);
        }
        if (iterations >= maxIterations && executable.length > 0) {
            response += `\n[WARN] Maximum iterations reached. Possible deadlock.\n`;
        }
        const remaining = Array.from(team.tasks.values())
            .filter(t => t.status === "pending" || t.status === "blocked").length;
        response += `\n---\n`;
        response += `**Completed**: ${totalCompleted}\n`;
        response += `**Failed**: ${totalFailed}\n`;
        response += `**Remaining**: ${remaining}\n`;
        return response;
    }
});
const taskListTool = tool({
    description: "List all tasks in a team",
    args: {
        teamId: z.string().describe("Team ID")
    },
    async execute(args) {
        const team = teams.get(args.teamId);
        if (!team) {
            return `Error: Team ${args.teamId} not found`;
        }
        if (!team.tasks || team.tasks.size === 0) {
            return "No tasks. Use `/task-create` to add tasks.";
        }
        let response = `## Tasks (${team.tasks.size})\n\n`;
        const statusIcon = {
            pending: "[ ]",
            in_progress: "[>]",
            completed: "[OK]",
            blocked: "[!]",
            error: "[X]"
        };
        for (const [, task] of team.tasks) {
            const icon = statusIcon[task.status];
            response += `${icon} **${task.subject}** (${task.id})\n`;
            response += `   - Status: ${task.status}\n`;
            response += `   - Owner: ${task.owner || "Unassigned"}\n`;
            if (task.blockedBy.length > 0) {
                response += `   - Blocked by: ${task.blockedBy.length} tasks\n`;
            }
        }
        return response;
    }
});
const taskUpdateTool = tool({
    description: "Update task status, owner, or dependencies",
    args: {
        teamId: z.string().describe("Team ID"),
        taskId: z.string().describe("Task ID to update"),
        status: z.enum(["pending", "in_progress", "completed", "blocked", "error"]).optional().describe("New status"),
        owner: z.string().optional().describe("New owner (agent name)"),
        addBlockedBy: z.string().optional().describe("Comma-separated task IDs to add as dependencies"),
        addBlocks: z.string().optional().describe("Comma-separated task IDs that this task blocks")
    },
    async execute(args) {
        const team = teams.get(args.teamId);
        if (!team) {
            return `Error: Team ${args.teamId} not found`;
        }
        if (!team.tasks) {
            team.tasks = new Map();
        }
        const task = team.tasks.get(args.taskId);
        if (!task) {
            return `Error: Task ${args.taskId} not found`;
        }
        // Update status
        if (args.status) {
            task.status = args.status;
            if (args.status === "completed") {
                task.completedAt = new Date();
            }
        }
        // Update owner
        if (args.owner !== undefined) {
            task.owner = args.owner || undefined;
        }
        // Add blockedBy dependencies
        if (args.addBlockedBy) {
            const newDeps = args.addBlockedBy.split(",").map(s => s.trim()).filter(Boolean);
            for (const depId of newDeps) {
                if (!task.blockedBy.includes(depId)) {
                    task.blockedBy.push(depId);
                }
                // Update reverse reference
                const depTask = team.tasks.get(depId);
                if (depTask && !depTask.blocks.includes(task.id)) {
                    depTask.blocks.push(task.id);
                }
            }
        }
        // Add blocks dependencies
        if (args.addBlocks) {
            const newBlocks = args.addBlocks.split(",").map(s => s.trim()).filter(Boolean);
            for (const blockId of newBlocks) {
                if (!task.blocks.includes(blockId)) {
                    task.blocks.push(blockId);
                }
                // Update reverse reference
                const blockTask = team.tasks.get(blockId);
                if (blockTask && !blockTask.blockedBy.includes(task.id)) {
                    blockTask.blockedBy.push(task.id);
                }
            }
        }
        saveTeam(team);
        let response = `## Task Updated\n\n`;
        response += `**Task ID**: ${task.id}\n`;
        response += `**Subject**: ${task.subject}\n`;
        response += `**Status**: ${task.status}\n`;
        response += `**Owner**: ${task.owner || "Unassigned"}\n`;
        response += `**Blocked By**: ${task.blockedBy.length} tasks\n`;
        response += `**Blocks**: ${task.blocks.length} tasks\n`;
        return response;
    }
});
// ============================================================================
// PLAN APPROVAL TOOLS
// ============================================================================
const planSubmitTool = tool({
    description: "Submit a plan for leader approval before execution",
    args: {
        agentId: z.string().describe("Agent ID submitting the plan"),
        agentName: z.string().describe("Agent name submitting the plan"),
        content: z.string().describe("Plan content/description"),
    },
    async execute(args) {
        // 입력 검증
        if (!args.agentId || args.agentId.trim() === "") {
            return `Error: Agent ID is required`;
        }
        if (!args.agentName || args.agentName.trim() === "") {
            return `Error: Agent name is required`;
        }
        if (!args.content || args.content.trim() === "") {
            return `Error: Plan content is required`;
        }
        const plan = createPlan(args.agentId, args.agentName, args.content);
        let response = `## Plan Submitted for Approval\n\n`;
        response += `**Plan ID**: ${plan.id}\n`;
        response += `**Agent**: ${plan.agentName} (${plan.agentId})\n`;
        response += `**Status**: ${plan.status}\n`;
        response += `**Submitted**: ${plan.submittedAt.toISOString()}\n\n`;
        response += `### Plan Content\n`;
        response += `${plan.content}\n\n`;
        response += `---\n`;
        response += `Waiting for leader approval. Use \`/plan-approve planId="${plan.id}"\` or \`/plan-reject planId="${plan.id}"\`\n`;
        return response;
    },
});
const planApproveTool = tool({
    description: "Approve a submitted plan, allowing the agent to proceed with execution",
    args: {
        planId: z.string().describe("Plan ID to approve"),
    },
    async execute(args) {
        // 입력 검증
        if (!args.planId || args.planId.trim() === "") {
            return `Error: Plan ID is required`;
        }
        const plan = updatePlanStatus(args.planId, "approved");
        if (!plan) {
            return `Error: Plan ${args.planId} not found`;
        }
        let response = `## Plan Approved\n\n`;
        response += `**Plan ID**: ${plan.id}\n`;
        response += `**Agent**: ${plan.agentName}\n`;
        response += `**Status**: ${plan.status}\n`;
        response += `**Approved At**: ${plan.reviewedAt?.toISOString()}\n\n`;
        response += `### Approved Plan\n`;
        response += `${plan.content}\n\n`;
        response += `---\n`;
        response += `The agent may now proceed with execution.\n`;
        return response;
    },
});
const planRejectTool = tool({
    description: "Reject a submitted plan with feedback, requiring the agent to revise",
    args: {
        planId: z.string().describe("Plan ID to reject"),
        feedback: z.string().describe("Reason for rejection and improvement suggestions"),
    },
    async execute(args) {
        // 입력 검증
        if (!args.planId || args.planId.trim() === "") {
            return `Error: Plan ID is required`;
        }
        if (!args.feedback || args.feedback.trim() === "") {
            return `Error: Feedback is required for rejection`;
        }
        const plan = updatePlanStatus(args.planId, "rejected", args.feedback);
        if (!plan) {
            return `Error: Plan ${args.planId} not found`;
        }
        let response = `## Plan Rejected\n\n`;
        response += `**Plan ID**: ${plan.id}\n`;
        response += `**Agent**: ${plan.agentName}\n`;
        response += `**Status**: ${plan.status}\n`;
        response += `**Rejected At**: ${plan.reviewedAt?.toISOString()}\n\n`;
        response += `### Feedback\n`;
        response += `${args.feedback}\n\n`;
        response += `---\n`;
        response += `The agent should revise the plan and resubmit.\n`;
        return response;
    },
});
const planListTool = tool({
    description: "List all plans with their status",
    args: {
        status: z.enum(["pending", "approved", "rejected"]).optional().describe("Filter by status"),
        agentId: z.string().optional().describe("Filter by agent ID"),
    },
    async execute(args) {
        let filteredPlans = Array.from(plans.values());
        if (args.status) {
            filteredPlans = filteredPlans.filter(p => p.status === args.status);
        }
        if (args.agentId) {
            filteredPlans = filteredPlans.filter(p => p.agentId === args.agentId);
        }
        if (filteredPlans.length === 0) {
            return "No plans found.";
        }
        let response = `## Plans (${filteredPlans.length})\n\n`;
        for (const plan of filteredPlans) {
            const statusIcon = {
                pending: "[PENDING]",
                approved: "[APPROVED]",
                rejected: "[REJECTED]",
            };
            response += `${statusIcon[plan.status]} **${plan.id}**\n`;
            response += `- Agent: ${plan.agentName} (${plan.agentId})\n`;
            response += `- Status: ${plan.status}\n`;
            response += `- Submitted: ${plan.submittedAt.toISOString()}\n`;
            if (plan.feedback) {
                response += `- Feedback: ${plan.feedback}\n`;
            }
            response += `\n### Content\n`;
            response += `${truncateText(plan.content, 300)}\n\n`;
            response += `---\n\n`;
        }
        return response;
    },
});
const planStatusTool = tool({
    description: "Get detailed status of a specific plan",
    args: {
        planId: z.string().describe("Plan ID"),
    },
    async execute(args) {
        const plan = getPlan(args.planId);
        if (!plan) {
            return `Error: Plan ${args.planId} not found`;
        }
        let response = `## Plan Details\n\n`;
        response += `**Plan ID**: ${plan.id}\n`;
        response += `**Agent**: ${plan.agentName} (${plan.agentId})\n`;
        response += `**Status**: ${plan.status}\n`;
        response += `**Submitted**: ${plan.submittedAt.toISOString()}\n`;
        if (plan.reviewedAt) {
            response += `**Reviewed**: ${plan.reviewedAt.toISOString()}\n`;
        }
        response += `\n### Plan Content\n`;
        response += `${plan.content}\n`;
        if (plan.feedback) {
            response += `\n### Feedback\n`;
            response += `${plan.feedback}\n`;
        }
        return response;
    },
});
const planResubmitTool = tool({
    description: "Resubmit a rejected plan with revisions",
    args: {
        planId: z.string().describe("Original plan ID to resubmit"),
        content: z.string().describe("Revised plan content"),
    },
    async execute(args) {
        const originalPlan = getPlan(args.planId);
        if (!originalPlan) {
            return `Error: Plan ${args.planId} not found`;
        }
        if (originalPlan.status !== "rejected") {
            return `Error: Can only resubmit rejected plans. Current status: ${originalPlan.status}`;
        }
        const newPlan = createPlan(originalPlan.agentId, originalPlan.agentName, args.content);
        let response = `## Plan Resubmitted\n\n`;
        response += `**New Plan ID**: ${newPlan.id}\n`;
        response += `**Original Plan ID**: ${originalPlan.id}\n`;
        response += `**Agent**: ${newPlan.agentName}\n`;
        response += `**Status**: ${newPlan.status}\n`;
        response += `**Previous Feedback**: ${originalPlan.feedback || "None"}\n\n`;
        response += `### Revised Content\n`;
        response += `${newPlan.content}\n\n`;
        response += `---\n`;
        response += `Waiting for leader approval.\n`;
        return response;
    },
});
// ============================================================================
// REPUTATION TOOLS
// ============================================================================
const agentReputationTool = tool({
    description: "Get agent reputation information",
    args: {
        agentName: z.string().describe("Agent name to get reputation for"),
    },
    async execute(args) {
        const reputation = getAgentReputation(args.agentName);
        const successRate = reputation.totalTasks > 0
            ? ((reputation.successfulTasks / reputation.totalTasks) * 100).toFixed(1)
            : "N/A";
        let response = `## Agent Reputation: ${args.agentName}\n\n`;
        response += `**Total Tasks**: ${reputation.totalTasks}\n`;
        response += `**Successful Tasks**: ${reputation.successfulTasks}\n`;
        response += `**Success Rate**: ${successRate}%\n`;
        response += `**Average Score**: ${reputation.averageScore.toFixed(1)}\n`;
        response += `**Last Updated**: ${reputation.lastUpdated.toISOString()}\n`;
        return response;
    },
});
const agentScoreTool = tool({
    description: "Score an agent's performance",
    args: {
        agentName: z.string().describe("Agent name to score"),
        score: z.number().min(1).max(10).describe("Score from 1-10"),
        feedback: z.string().describe("Feedback for the score"),
        scoredBy: z.string().describe("Who is scoring this agent"),
    },
    async execute(args) {
        addAgentScore(args.agentName, args.score, args.feedback, args.scoredBy);
        let response = `## Agent Scored\n\n`;
        response += `**Agent**: ${args.agentName}\n`;
        response += `**Score**: ${args.score}/10\n`;
        response += `**Feedback**: ${args.feedback}\n`;
        response += `**Scored By**: ${args.scoredBy}\n\n`;
        response += `Score recorded and reputation updated.\n`;
        return response;
    },
});
const agentScoresTool = tool({
    description: "Get all scores for an agent",
    args: {
        agentName: z.string().describe("Agent name to get scores for"),
    },
    async execute(args) {
        const scores = getAgentScores(args.agentName);
        if (scores.length === 0) {
            return `No scores found for agent: ${args.agentName}`;
        }
        let response = `## Agent Scores: ${args.agentName}\n\n`;
        response += `**Total Scores**: ${scores.length}\n\n`;
        for (const s of scores) {
            response += `### Score ${s.score}/10\n`;
            response += `**By**: ${s.scoredBy}\n`;
            response += `**Feedback**: ${s.feedback}\n`;
            response += `**Date**: ${s.timestamp.toISOString()}\n\n`;
        }
        return response;
    },
});
const agentRankingsTool = tool({
    description: "Get agent rankings by performance",
    args: {
        sortBy: z.enum(["successRate", "averageScore", "totalTasks"]).optional().default("averageScore"),
    },
    async execute(args) {
        const rankings = Array.from(agentReputations.entries())
            .map(([name, rep]) => ({
            name,
            successRate: rep.totalTasks > 0 ? rep.successfulTasks / rep.totalTasks : 0,
            averageScore: rep.averageScore,
            totalTasks: rep.totalTasks,
        }))
            .sort((a, b) => {
            if (args.sortBy === "successRate")
                return b.successRate - a.successRate;
            if (args.sortBy === "totalTasks")
                return b.totalTasks - a.totalTasks;
            return b.averageScore - a.averageScore;
        });
        if (rankings.length === 0) {
            return `No agent rankings available yet.`;
        }
        let response = `## Agent Rankings (by ${args.sortBy})\n\n`;
        rankings.forEach((r, i) => {
            response += `**${i + 1}. ${r.name}**\n`;
            response += `   - Success Rate: ${(r.successRate * 100).toFixed(1)}%\n`;
            response += `   - Average Score: ${r.averageScore.toFixed(1)}\n`;
            response += `   - Total Tasks: ${r.totalTasks}\n\n`;
        });
        return response;
    },
});
// ============================================================================
// VOTING SYSTEM TOOL (차별화 기능 2: 투표/합의 시스템)
// ============================================================================
const teamVoteTool = tool({
    description: "Run a vote among team agents on a proposal (차별화 기능: 투표/합의 시스템)",
    args: {
        teamId: z.string().describe("Team ID"),
        proposal: z.string().describe("Proposal to vote on"),
        threshold: z.enum(["majority", "unanimous"]).optional().describe("Consensus threshold (default: majority)"),
    },
    async execute(args) {
        if (!globalClient) {
            return "Error: OpenCode client not available";
        }
        // 입력 검증
        if (!args.teamId || args.teamId.trim() === "") {
            return `Error: Team ID is required`;
        }
        if (!args.proposal || args.proposal.trim() === "") {
            return `Error: Proposal is required`;
        }
        const team = teams.get(args.teamId);
        if (!team) {
            return `Error: Team ${args.teamId} not found`;
        }
        if (team.agents.size === 0) {
            return `Error: Team has no agents to vote`;
        }
        const threshold = args.threshold ?? "majority";
        let response = `## 🗳️ 투표 시작 (Vote Started)\n\n`;
        response += `**Team**: ${team.name}\n`;
        response += `**제안 (Proposal)**: ${args.proposal}\n`;
        response += `**합의 기준 (Threshold)**: ${threshold === "unanimous" ? "만장일치 (Unanimous)" : "다수결 (Majority)"}\n\n`;
        const votes = [];
        const votePromises = [];
        for (const [name, agent] of team.agents) {
            const votePrompt = `다음 제안에 대해 투표해주세요:

## 제안 (Proposal)
${args.proposal}

## 투표 옵션
1. **approve** (찬성) - 이 제안을 지지합니다
2. **reject** (반대) - 이 제안에 반대합니다
3. **abstain** (기권) - 의견을 유보합니다

## 응답 형식
**투표**: [approve/reject/abstain]
**사유**: [간단한 이유]

당신은 ${name}(${agent.role}) 역할입니다. 이 제안에 대해 투표해주세요.`;
            const votePromise = (async () => {
                try {
                    agent.status = "thinking";
                    const { sessionID } = await spawnAgentSession(name, votePrompt);
                    agent.sessionID = sessionID;
                    agent.status = "responding";
                    const result = await waitForSessionCompletion(sessionID, DEFAULT_TIMEOUT_MS);
                    agent.status = "completed";
                    // Parse vote from result
                    const voteMatch = result.match(/투표\s*[:：]\s*(approve|reject|abstain)/i) ||
                        result.match(/vote\s*[:：]\s*(approve|reject|abstain)/i);
                    const reasonMatch = result.match(/사유\s*[:：]\s*(.+)/i) ||
                        result.match(/reason\s*[:：]\s*(.+)/i);
                    const vote = (voteMatch?.[1]?.toLowerCase() || "abstain");
                    const reason = reasonMatch?.[1] || truncateText(result, 200);
                    return { name, vote, reason };
                }
                catch (error) {
                    agent.status = "error";
                    return { name, vote: "abstain", reason: "Error during voting" };
                }
            })();
            votePromises.push(votePromise);
        }
        const voteResults = await Promise.allSettled(votePromises);
        for (const r of voteResults) {
            if (r.status === "fulfilled") {
                const { name, vote, reason } = r.value;
                votes.push({ agentName: name, vote, reason });
            }
        }
        // Count votes
        const approve = votes.filter(v => v.vote === "approve").length;
        const reject = votes.filter(v => v.vote === "reject").length;
        const abstain = votes.filter(v => v.vote === "abstain").length;
        const total = votes.length;
        // Determine consensus
        let consensus;
        if (threshold === "unanimous") {
            consensus = approve === total ? "unanimous" : "no_consensus";
        }
        else {
            consensus = approve > reject ? "majority" : "no_consensus";
        }
        // Save voting result
        const votingResult = {
            proposal: args.proposal,
            votes,
            approve,
            reject,
            abstain,
            consensus,
            timestamp: new Date(),
        };
        if (!votingHistory.has(args.teamId)) {
            votingHistory.set(args.teamId, []);
        }
        votingHistory.get(args.teamId).push(votingResult);
        // Format response
        response += `---\n\n## 📊 투표 결과 (Voting Results)\n\n`;
        const voteIcons = {
            approve: "✅",
            reject: "❌",
            abstain: "⚪",
        };
        for (const v of votes) {
            const icon = voteIcons[v.vote] || "⚪";
            response += `${icon} **${v.agentName}**: ${v.vote}`;
            if (v.reason) {
                response += `\n   _${v.reason}_`;
            }
            response += `\n\n`;
        }
        response += `---\n\n## 📈 집계 (Summary)\n\n`;
        response += `| 찬성 (Approve) | 반대 (Reject) | 기권 (Abstain) | 합계 (Total) |\n`;
        response += `|:-------------:|:-------------:|:--------------:|:-------------:|\n`;
        response += `| ${approve} | ${reject} | ${abstain} | ${total} |\n\n`;
        const consensusKorean = {
            unanimous: "✅ **만장일치 합의 (Unanimous Consensus)**",
            majority: "✅ **다수결 합의 (Majority Consensus)**",
            "no_consensus": "❌ **합의 도달 실패 (No Consensus)**",
        };
        response += `**결과 (Result)**: ${consensusKorean[consensus]}\n`;
        response += `\n---\n\n**Team ID**: ${args.teamId}`;
        return response;
    },
});
// ============================================================================
// TEAM SCORE TOOL (차별화 기능: 팀 결과 채점)
// ============================================================================
const teamScoreTool = tool({
    description: "Score an agent's performance within a team context",
    args: {
        teamId: z.string().describe("Team ID"),
        agentId: z.string().describe("Agent to score"),
        score: z.number().min(1).max(10).describe("Score from 1-10"),
        feedback: z.string().describe("Feedback for the score"),
    },
    async execute(args) {
        const team = teams.get(args.teamId);
        if (!team) {
            return `Error: Team ${args.teamId} not found`;
        }
        const agent = team.agents.get(args.agentId);
        if (!agent) {
            return `Error: Agent ${args.agentId} not found in team`;
        }
        // Add score using existing scoring system
        addAgentScore(args.agentId, args.score, args.feedback, "team-lead");
        // Get updated reputation
        const reputation = getAgentReputation(args.agentId);
        const successRate = reputation.totalTasks > 0
            ? ((reputation.successfulTasks / reputation.totalTasks) * 100).toFixed(1)
            : "N/A";
        let response = `## 📊 Agent Scored\n\n`;
        response += `**Team**: ${team.name}\n`;
        response += `**Agent**: ${args.agentId}\n`;
        response += `**Score**: ${args.score}/10\n`;
        response += `**Feedback**: ${args.feedback}\n\n`;
        response += `---\n\n`;
        response += `## Updated Reputation\n\n`;
        response += `**Average Score**: ${reputation.averageScore.toFixed(1)}/10\n`;
        response += `**Success Rate**: ${successRate}%\n`;
        response += `**Total Tasks**: ${reputation.totalTasks}\n`;
        return response;
    },
});
// ============================================================================
// SUMMARY BOT TOOL (차별화 기능 4: 종합 보고서 봇)
// ============================================================================
const teamSummarizeTool = tool({
    description: "Generate a comprehensive summary report from all team discussions and results (차별화 기능: 종합 보고서 봇)",
    args: {
        teamId: z.string().describe("Team ID"),
        language: z.enum(["korean", "english"]).optional().describe("Summary language (default: korean)"),
    },
    async execute(args) {
        if (!globalClient) {
            return "Error: OpenCode client not available";
        }
        const team = teams.get(args.teamId);
        if (!team) {
            return `Error: Team ${args.teamId} not found`;
        }
        const language = args.language ?? "korean";
        const isKorean = language === "korean";
        // Collect all agent results
        const agentResults = Array.from(team.agents.entries())
            .filter(([_, agent]) => agent.result)
            .map(([name, agent]) => `### ${name}\n${agent.result}`)
            .join("\n\n");
        if (!agentResults) {
            return isKorean
                ? "Error: 분석 결과가 없습니다. 먼저 에이전트를 실행하세요."
                : "Error: No results found. Run agents first.";
        }
        // Use a planner agent or the first available agent for summary
        const summaryAgentName = team.agents.has("planner") ? "planner" : Array.from(team.agents.keys())[0];
        const summaryPrompt = isKorean
            ? `${SUMMARY_BOT_PROMPT}

## 팀 정보
- **팀명**: ${team.name}
- **작업**: ${team.task}

## 에이전트별 결과
${agentResults}

위 모든 에이전트의 결과를 분석하여 종합 보고서를 작성하세요.`
            : `You are a comprehensive report writer.

## Team Information
- **Team**: ${team.name}
- **Task**: ${team.task}

## Agent Results
${agentResults}

Analyze all agent results and create a comprehensive summary report with:
1. **Executive Summary**: Key conclusions
2. **Agent Opinions Table**: Summary of each agent's position
3. **Agreed Items**: What everyone agreed on
4. **Disputed Items**: Where opinions differed
5. **Risks/Issues Found**: With severity and proposed solutions
6. **Next Steps**: Specific action items`;
        try {
            const agent = team.agents.get(summaryAgentName);
            if (!agent) {
                return "Error: No agent available for summary";
            }
            agent.status = "thinking";
            const { sessionID } = await spawnAgentSession(summaryAgentName, summaryPrompt);
            agent.sessionID = sessionID;
            agent.status = "responding";
            const summary = await waitForSessionCompletion(sessionID, DEFAULT_TIMEOUT_MS);
            agent.status = "completed";
            let response = isKorean
                ? `## 📋 종합 보고서 (Summary Report)\n\n`
                : `## 📋 Summary Report\n\n`;
            response += `**Team**: ${team.name}\n`;
            response += `**Task**: ${team.task}\n`;
            response += `**Generated**: ${new Date().toISOString()}\n\n`;
            response += `---\n\n`;
            response += summary;
            return response;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return `Error generating summary: ${errorMessage}`;
        }
    },
});
// ============================================================================
// AGENT HANDOFF TOOL (차별화 기능: 에이전트 간 작업 위임)
// ============================================================================
const agentHandoffTool = tool({
    description: "Allow agents to delegate tasks to each other mid-execution (차별화 기능: 에이전트 핸드오프)",
    args: {
        teamId: z.string().describe("Team ID"),
        fromAgent: z.string().describe("Agent delegating the task"),
        toAgent: z.string().describe("Agent receiving the delegation"),
        task: z.string().describe("Task to delegate"),
        reason: z.string().describe("Reason for delegation"),
    },
    async execute(args) {
        const team = teams.get(args.teamId);
        if (!team) {
            return `Error: Team ${args.teamId} not found`;
        }
        const fromAgent = team.agents.get(args.fromAgent);
        const toAgent = team.agents.get(args.toAgent);
        if (!fromAgent || !toAgent) {
            return `Error: One or both agents not found in team`;
        }
        // Record handoff
        const handoff = {
            fromAgent: args.fromAgent,
            toAgent: args.toAgent,
            task: args.task,
            reason: args.reason,
            timestamp: new Date(),
        };
        handoffRequests.set(`${args.teamId}-${Date.now()}`, handoff);
        // Execute the delegated task
        try {
            toAgent.status = "thinking";
            const { sessionID } = await spawnAgentSession(args.toAgent, args.task);
            toAgent.sessionID = sessionID;
            toAgent.status = "responding";
            const result = await waitForSessionCompletion(sessionID, DEFAULT_TIMEOUT_MS);
            toAgent.status = "completed";
            toAgent.result = result;
            let response = `## 🔄 Agent Handoff\n\n`;
            response += `**From**: ${args.fromAgent}\n`;
            response += `**To**: ${args.toAgent}\n`;
            response += `**Reason**: ${args.reason}\n\n`;
            response += `### Delegated Task\n${args.task}\n\n`;
            response += `### Result\n${truncateText(result, MAX_RESULT_LENGTH)}\n`;
            return response;
        }
        catch (error) {
            toAgent.status = "error";
            const errorMessage = error instanceof Error ? error.message : String(error);
            return `Error during handoff: ${errorMessage}`;
        }
    },
});
// ============================================================================
// CONFLICT RESOLUTION TOOL (차별화 기능: 구조화된 충돌 해결)
// ============================================================================
const conflictResolveTool = tool({
    description: "Structured debate format when agents disagree (차별화 기능: 충돌 해결)",
    args: {
        teamId: z.string().describe("Team ID"),
        topic: z.string().describe("Topic of disagreement"),
        positions: z.array(z.object({
            agent: z.string().describe("Agent name"),
            position: z.string().describe("Agent's position"),
        })).describe("Each agent's position on the topic"),
    },
    async execute(args) {
        const team = teams.get(args.teamId);
        if (!team) {
            return `Error: Team ${args.teamId} not found`;
        }
        // Record conflict
        const conflict = {
            topic: args.topic,
            agents: args.positions.map(p => p.agent),
            positions: args.positions.map(p => p.position),
            timestamp: new Date(),
            resolved: false,
        };
        conflicts.set(`${args.teamId}-${Date.now()}`, conflict);
        let response = `## ⚖️ Conflict Resolution: ${args.topic}\n\n`;
        // Phase 1: Present positions
        response += `### Phase 1: Positions\n\n`;
        for (const pos of args.positions) {
            response += `**${pos.agent}**: ${pos.position}\n\n`;
        }
        // Phase 2: Devil's Advocate critique
        const daAgent = Array.from(team.agents.values()).find(a => isDevilsAdvocate(a.name));
        if (daAgent) {
            response += `### Phase 2: Devil's Advocate Critique\n\n`;
            const critiquePrompt = `다음 주제에 대해 에이전트들이 서로 다른 의견을 가지고 있습니다:

## 주제: ${args.topic}

## 각 에이전트 입장:
${args.positions.map(p => `- ${p.agent}: ${p.position}`).join('\n')}

## Devil's Advocate 역할
위 입장들에 대해 비판적 분석을 하세요:
1. 각 입장의 약점
2. 놓친 관점
3. 더 나은 대안

반드시 비판적이어야 합니다.`;
            try {
                const { sessionID } = await spawnAgentSession(daAgent.name, critiquePrompt);
                const critique = await waitForSessionCompletion(sessionID, DEFAULT_TIMEOUT_MS);
                response += `**${daAgent.name}**:\n${truncateText(critique, MAX_RESULT_LENGTH)}\n\n`;
            }
            catch (error) {
                response += `[Devil's Advocate 분석 실패]\n\n`;
            }
        }
        // Phase 3: Proposed resolution
        response += `### Phase 3: Proposed Resolution\n\n`;
        response += `Use \`/team-vote\` to vote on the best approach.\n`;
        response += `\n---\n\n**Team ID**: ${args.teamId}`;
        return response;
    },
});
// ============================================================================
// DEVIL'S ADVOCATE AUTO CRITIQUE TOOL (차별화 기능: 자동 반론 생성)
// ============================================================================
const daCritiqueTool = tool({
    description: "Devil's Advocate automatically critiques other agents' results (차별화 기능: 자동 반론 생성)",
    args: {
        teamId: z.string().describe("Team ID"),
        targetAgent: z.string().describe("Agent to critique (omit for all agents)"),
    },
    async execute(args) {
        if (!globalClient) {
            return "Error: OpenCode client not available";
        }
        const team = teams.get(args.teamId);
        if (!team) {
            return `Error: Team ${args.teamId} not found`;
        }
        // Check if Devil's Advocate exists in team
        const daAgent = Array.from(team.agents.values()).find(a => isDevilsAdvocate(a.name));
        if (!daAgent) {
            return "Error: No Devil's Advocate in team. Add one to use auto-critique.";
        }
        let response = `## 🚨 Devil's Advocate Auto-Critique\n\n`;
        response += `**Team**: ${team.name}\n`;
        response += `**Devil's Advocate**: ${daAgent.name}\n\n`;
        // Determine which agents to critique
        const agentsToCritique = args.targetAgent
            ? [[args.targetAgent, team.agents.get(args.targetAgent)]].filter(([, a]) => a)
            : Array.from(team.agents.entries()).filter(([name]) => !isDevilsAdvocate(name));
        if (agentsToCritique.length === 0) {
            return "Error: No agents to critique (agent not found or only DA in team)";
        }
        // Generate critiques
        for (const [name, agent] of agentsToCritique) {
            if (!agent?.result) {
                response += `### ${name}\n[No results to critique]\n\n`;
                continue;
            }
            response += `### 🎯 Critique: ${name}\n\n`;
            const critique = await generateDevilsAdvocateCritique(name, agent.result, team);
            response += `${truncateText(critique, MAX_RESULT_LENGTH)}\n\n`;
            response += `---\n\n`;
        }
        response += `**Team ID**: ${args.teamId}`;
        return response;
    },
});
// ============================================================================
// PLUGIN EXPORT
// ============================================================================
const plugin = async (input) => {
    globalClient = input.client;
    loadOpenCodeAgents();
    loadPlans();
    loadReputations();
    loadScores();
    return {
        tool: {
            "team-spawn": teamSpawnTool,
            "team-execute": teamExecuteTool,
            "team-discuss": teamDiscussTool,
            "team-status": teamStatusTool,
            "team-shutdown": teamShutdownTool,
            "team-auto": teamAutoTool,
            "task-create": taskCreateTool,
            "task-update": taskUpdateTool,
            "task-execute": taskExecuteTool,
            "task-list": taskListTool,
            "plan-submit": planSubmitTool,
            "plan-approve": planApproveTool,
            "plan-reject": planRejectTool,
            "plan-list": planListTool,
            "plan-status": planStatusTool,
            "plan-resubmit": planResubmitTool,
            "agent-reputation": agentReputationTool,
            "agent-score": agentScoreTool,
            "agent-scores": agentScoresTool,
            "agent-rankings": agentRankingsTool,
            // 차별화 기능 (Differentiation features)
            "team-vote": teamVoteTool,
            "team-score": teamScoreTool,
            "team-summarize": teamSummarizeTool,
            "agent-handoff": agentHandoffTool,
            "conflict-resolve": conflictResolveTool,
            "da-critique": daCritiqueTool,
        },
    };
};
export default plugin;
