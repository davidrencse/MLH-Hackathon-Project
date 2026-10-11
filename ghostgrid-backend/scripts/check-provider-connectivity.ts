import { createInterface } from "node:readline";
import { OpenAICompatibleAdapter } from "../src/providers/openai-compatible.js";

// Model discovery only: this command never calls an inference endpoint or starts workers.
if (process.argv.includes("--stdin-keys")) {
  const lines = createInterface({ input: process.stdin, terminal: false });
  try {
    const line = await new Promise<string>((resolve, reject) => {
      lines.once("line", resolve);
      lines.once("close", () => reject(new Error("No credential input received")));
    });
    const keys: unknown = JSON.parse(line);
    if (!keys || typeof keys !== "object") throw new Error("Invalid credential input");
    for (const name of ["GROQ_API_KEY", "DEEPSEEK_API_KEY"] as const) {
      const value = (keys as Record<string, unknown>)[name];
      if (value !== undefined) {
        if (typeof value !== "string" || !value || /[\r\n]/.test(value))
          throw new Error("Invalid credential input");
        process.env[name] = value;
      }
    }
  } catch {
    console.error("Credential input must be a JSON object containing API-key environment variables");
    process.exitCode = 1;
  } finally {
    lines.close();
    process.stdin.pause();
  }
}

if (!process.exitCode) {
  for (const preset of [
    { name: "Groq", baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY" },
    { name: "DeepSeek", baseUrl: "https://api.deepseek.com", apiKeyEnv: "DEEPSEEK_API_KEY" },
  ]) {
    if (!process.env[preset.apiKeyEnv]) {
      console.log(JSON.stringify({ provider: preset.name, status: "skipped", reason: `${preset.apiKeyEnv} is unset` }));
      continue;
    }
    const adapter = new OpenAICompatibleAdapter({
      ...preset, id: preset.name.toLowerCase(), type: "openai-compatible",
      auth: "bearer", concurrency: 1, timeoutMs: 15_000,
    });
    const result = await adapter.checkAvailability();
    const models = "models" in result ? result.models : undefined;
    const reachable = Array.isArray(models);
    console.log(JSON.stringify({
      provider: preset.name, status: reachable ? "authenticated" : "failed",
      endpoint: `${preset.baseUrl}/models`,
      ...(reachable ? { models } : { message: result.message }),
      inferenceRequests: 0,
    }));
    if (!reachable) process.exitCode = 1;
  }
}
