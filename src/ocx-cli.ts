import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface OcxCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

export async function runOcx(args: string[], timeoutMs = 15_000): Promise<OcxCommandResult> {
  try {
    const result = await execFileAsync("ocx", args, {
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      env: process.env,
    });
    return { ok: true, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return {
      ok: false,
      stdout: typeof err.stdout === "string" ? err.stdout.trim() : "",
      stderr: typeof err.stderr === "string" ? err.stderr.trim() : "",
      error: err.code === "ENOENT" ? "ocx command not found" : err.message,
    };
  }
}

export async function ocxReady(): Promise<OcxCommandResult> {
  return runOcx(["ready", "--json"], 8_000);
}

export async function ocxStatus(): Promise<OcxCommandResult> {
  return runOcx(["status", "--json"], 12_000);
}

export async function ocxStart(): Promise<OcxCommandResult> {
  return runOcx(["start"], 30_000);
}

export async function ocxSync(): Promise<OcxCommandResult> {
  return runOcx(["sync"], 120_000);
}

export async function waitForOcxReady(attempts = 20, delayMs = 250): Promise<OcxCommandResult> {
  let last = await ocxReady();
  for (let i = 1; i < attempts && !last.ok; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    last = await ocxReady();
  }
  return last;
}
