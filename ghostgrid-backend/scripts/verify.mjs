// Use the package manager that launched this script (npm, pnpm or Yarn).
import { spawn } from "node:child_process";

const runner = process.env.npm_execpath;
if (!runner) throw new Error("Run verification with npm run verify or pnpm verify");

for (const script of ["check", "check:scripts", "test", "build", "test:built", "test:http", "demo"]) {
  console.log(`Verifying ${script}`);
  const child = spawn(process.execPath, [runner, "run", script], { stdio: "inherit" });
  let interrupted;
  const forward = (signal) => {
    interrupted = signal;
    child.kill(signal);
  };
  const interrupt = () => forward("SIGINT");
  const terminate = () => forward("SIGTERM");
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
  }
  if (interrupted || result.code !== 0 || result.signal) {
    process.exitCode = interrupted === "SIGINT" ? 130 : interrupted === "SIGTERM" ? 143 : result.code ?? 1;
    const signal = interrupted ?? result.signal;
    console.error(`Verification stopped at ${script}${signal ? ` (${signal})` : ""}`);
    break;
  }
}
