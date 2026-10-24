export interface DoctorCheck { ok: boolean; required: boolean; name: string; why: string }
export interface DoctorReport {
  /** True only when the engine ran and printed its checks. */
  engine: boolean;
  checks: DoctorCheck[];
  fixes: string[];
  /** When the engine didn't run: what it said, or why we think it didn't. */
  error?: string;
  install: string;
}

export const INSTALL_LINE = "./scripts/install";

/** Turns the output of `yap-machine doctor` into checks, fixes and (when it didn't run) an error to show. */
export function parseDoctor(code: number, out: string): DoctorReport {
  const checks = out.split("\n").filter((l) => /^\s+[✓✗·]/.test(l)).map((l) => {
    const m = l.trim().match(/^([✓✗·])\s+(.+?)\s{2,}(.+)$/);
    return m ? { ok: m[1] === "✓", required: m[1] !== "·", name: m[2], why: m[3] } : null;
  }).filter((c): c is DoctorCheck => c !== null);
  const fixes = out.split("\n").filter((l) => l.trim().startsWith("→")).map((l) => l.trim().slice(2));
  const engine = code !== 127 && checks.length > 0;
  let error: string | undefined;
  if (!engine) {
    const said = out.trim().split("\n").map((l) => l.trim()).filter(Boolean).slice(-4).join("\n");
    error = said || (code === 127 ? "The command wasn't found." : `yap-machine doctor stopped (exit ${code}) without listing any tools.`);
  }
  return { engine, checks, fixes, error, install: INSTALL_LINE };
}
