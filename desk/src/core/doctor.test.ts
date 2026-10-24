import { describe, expect, it } from "vitest";
import { INSTALL_LINE, parseDoctor } from "./doctor.js";

const OK = `yap-machine doctor
  ✓ ffmpeg            cuts and renders
  ✗ whisper           transcribes your voice
  · yt-dlp            optional
→ pip install openai-whisper
`;

describe("parseDoctor", () => {
  it("reads checks and fixes when the engine ran", () => {
    const r = parseDoctor(0, OK);
    expect(r.engine).toBe(true);
    expect(r.checks.map((c) => [c.name, c.ok, c.required])).toEqual([["ffmpeg", true, true], ["whisper", false, true], ["yt-dlp", false, false]]);
    expect(r.fixes).toEqual(["pip install openai-whisper"]);
    expect(r.error).toBeUndefined();
  });

  it("says the engine didn't run, with what it said, when the command is missing", () => {
    const r = parseDoctor(127, "\nspawn /nonexistent/yap-machine ENOENT");
    expect(r.engine).toBe(false);
    expect(r.checks).toEqual([]);
    expect(r.error).toContain("ENOENT");
    expect(r.install).toBe(INSTALL_LINE);
  });

  it("does not call an engine that listed no tools 'ready', even if it exited cleanly", () => {
    const r = parseDoctor(0, "");
    expect(r.engine).toBe(false);
    expect(r.error).toMatch(/without listing any tools/);
  });
});
