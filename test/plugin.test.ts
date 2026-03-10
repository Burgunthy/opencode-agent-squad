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
    // v2.0 simplified to 4 core tools
    expect(Object.keys(result.tool).length).toBe(4);
  });

  test("all required tools are present", async () => {
    const { default: plugin } = await import(distFile);
    const result = await plugin({ client: {} as any });
    const tools = Object.keys(result.tool);

    // v2.0 Core Tools (4)
    expect(tools).toContain("squad");
    expect(tools).toContain("team-spawn");
    expect(tools).toContain("team-execute");
    expect(tools).toContain("team-discuss");
  });
});
