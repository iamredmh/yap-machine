import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * How the desk runs the Python engine (`yap-machine`). In order:
 *   YAP_BIN               an explicit command, e.g. "/opt/yap/bin/yap"
 *   the repo checkout     the installed .venv executable, with uv as a pre-install fallback
 *   yap-machine on PATH    a separately configured engine outside a source checkout
 */
export function sourceCheckout(here = dirname(fileURLToPath(import.meta.url))): string | null {
  for (let at = here, i = 0; i < 6; at = dirname(at), i++) {
    if (existsSync(join(at, "pyproject.toml")) && existsSync(join(at, "src", "yap"))) {
      return resolve(at);
    }
  }
  return null;
}

export function engineCommand(opts: { fromDir?: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {}): { cmd: string; args: string[] } {
  const env = opts.env ?? process.env;
  if (env.YAP_BIN) return { cmd: env.YAP_BIN, args: [] };
  const root = sourceCheckout(opts.fromDir);
  if (root) {
    const executable = join(root, ".venv", (opts.platform ?? process.platform) === "win32" ? "Scripts/yap-machine.exe" : "bin/yap-machine");
    if (existsSync(executable)) return { cmd: executable, args: [] };
    return { cmd: "uv", args: ["run", "--quiet", "--project", root, "yap-machine"] };
  }
  return { cmd: "yap-machine", args: [] };
}

/** GUI agents often have only /usr/bin:/bin. Keep local tools discoverable without saving a user's shell environment. */
export function runtimeEnvironment(opts: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; nodeExecutable?: string; fromDir?: string } = {}): NodeJS.ProcessEnv {
  const env = opts.env ?? process.env, platform = opts.platform ?? process.platform;
  const root = sourceCheckout(opts.fromDir), separator = platform === "win32" ? ";" : ":";
  const key = platform === "win32" && env.Path && !env.PATH ? "Path" : "PATH";
  const paths = [dirname(opts.nodeExecutable ?? process.execPath),
    ...(root ? [join(root, ".venv", platform === "win32" ? "Scripts" : "bin")] : []),
    ...(platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin"] : []),
    ...(env[key] ?? "").split(separator).filter(Boolean)];
  // Explicit source discovery also works when Python skips an editable-install .pth file.
  const pythonPath = root ? [join(root, "src"), ...(env.PYTHONPATH ? [env.PYTHONPATH] : [])].join(separator) : undefined;
  return { ...env, [key]: [...new Set(paths)].join(separator), ...(pythonPath ? { PYTHONPATH: pythonPath } : {}) };
}

export interface RunResult { code: number; out: string }

/** Run `yap-machine …`, passing each output line to onLine as it arrives. */
export function runEngine(args: string[], onLine: (line: string) => void = () => undefined, cwd?: string): Promise<RunResult> {
  const { cmd, args: pre } = engineCommand();
  return new Promise((ok) => {
    let out = "";
    let child;
    try {
      child = spawn(cmd, [...pre, ...args], { cwd, env: runtimeEnvironment() });
    } catch (e) {
      ok({ code: 127, out: String(e) });
      return;
    }
    let buf = "";
    const take = (chunk: Buffer) => {
      const s = chunk.toString();
      out += s;
      buf += s;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trimEnd();
        buf = buf.slice(i + 1);
        if (line) onLine(line);
      }
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (e) => ok({ code: 127, out: `${out}\n${e.message}` }));
    child.on("close", (code) => {
      if (buf.trim()) onLine(buf.trim());
      ok({ code: code ?? 1, out });
    });
  });
}
