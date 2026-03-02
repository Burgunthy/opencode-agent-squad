import { describe, test, expect } from "bun:test";
import fs from "fs";
import path from "path";

describe("opencode-agent-squad plugin", () => {
  const pluginDir = path.join(__dirname, "..");
  const distFile = path.join(pluginDir, "dist", "index.js");
  const srcFile = path.join(pluginDir, "src", "index.ts");

  test("source file exists", () => {
    expect(fs.existsSync(srcFile)).toBe(true);
  });

  test("dist file exists after build", () => {
    expect(fs.existsSync(distFile)).toBe(true);
  });

  test("package.json has correct name", () => {
    const pkg = require(path.join(pluginDir, "package.json"));
    expect(pkg.name).toBe("@opencode-ai/agent-squad");
  });

  test("package.json has correct repository", () => {
    const pkg = require(path.join(pluginDir, "package.json"));
    expect(pkg.repository.url).toContain("opencode-agent-squad");
  });

  test("source exports plugin function", async () => {
    const { default: plugin } = await import(distFile);
    expect(typeof plugin).toBe("function");
  });

  test("plugin returns tools object", async () => {
    const { default: plugin } = await import(distFile);
    const result = await plugin({ client: {} as any });
    expect(result).toHaveProperty("tool");
    expect(Object.keys(result.tool).length).toBe(26);
  });

  test("all required tools are present", async () => {
    const { default: plugin } = await import(distFile);
    const result = await plugin({ client: {} as any });
    const tools = Object.keys(result.tool);

    // Team tools
    expect(tools).toContain("team-spawn");
    expect(tools).toContain("team-execute");
    expect(tools).toContain("team-discuss");
    expect(tools).toContain("team-status");
    expect(tools).toContain("team-shutdown");
    expect(tools).toContain("team-auto");

    // Task tools
    expect(tools).toContain("task-create");
    expect(tools).toContain("task-update");
    expect(tools).toContain("task-execute");
    expect(tools).toContain("task-list");

    // Plan tools
    expect(tools).toContain("plan-submit");
    expect(tools).toContain("plan-approve");
    expect(tools).toContain("plan-reject");
    expect(tools).toContain("plan-list");
    expect(tools).toContain("plan-status");
    expect(tools).toContain("plan-resubmit");

    // Reputation tools
    expect(tools).toContain("agent-reputation");
    expect(tools).toContain("agent-score");
    expect(tools).toContain("agent-scores");
    expect(tools).toContain("agent-rankings");

    // Differentiation tools
    expect(tools).toContain("team-vote");
    expect(tools).toContain("team-score");
    expect(tools).toContain("team-summarize");
    expect(tools).toContain("agent-handoff");
    expect(tools).toContain("conflict-resolve");
    expect(tools).toContain("da-critique");
  });
});
