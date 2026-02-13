export interface RunProcessOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: "inherit" | "ignore";
  stdout?: "inherit" | "pipe";
  stderr?: "inherit" | "pipe";
}

export async function runProcess(
  command: string,
  args: string[],
  options?: RunProcessOptions,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([command, ...args], {
    cwd: options?.cwd,
    env: options?.env,
    stdin: options?.stdin ?? "inherit",
    stdout: options?.stdout ?? "inherit",
    stderr: options?.stderr ?? "inherit",
  });

  const exitCode = await proc.exited;
  const stdout = options?.stdout === "pipe" ? await new Response(proc.stdout).text() : "";
  const stderr = options?.stderr === "pipe" ? await new Response(proc.stderr).text() : "";

  return { exitCode, stdout, stderr };
}
