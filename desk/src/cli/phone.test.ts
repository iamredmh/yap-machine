import { describe, expect, it } from "vitest";
import { describeLan, qrText } from "./phone.js";

describe("phone access in the terminal", () => {
  it("draws a QR code as text, at least a few dozen rows of blocks", () => {
    const t = qrText("http://192.168.1.20:4790/?k=abc");
    expect(t.split("\n").length).toBeGreaterThan(20);
    expect(t).toMatch(/[\u2580-\u2588]/);
  });
  it("says it is off when it is off", () => {
    expect(describeLan({ on: false, links: [] })).toEqual(["Phone access is off."]);
  });
  it("shows the QR, the main link, the others and the warning", () => {
    const lines = describeLan({ on: true, port: 4790, links: [
      { url: "http://192.168.1.20:4790/?k=abc", label: "This computer's address", address: "192.168.1.20" },
      { url: "http://box.local:4790/?k=abc", label: "This computer's name", address: "box.local" },
    ] }).join("\n");
    expect(lines).toContain("http://192.168.1.20:4790/?k=abc");
    expect(lines).toContain("http://box.local:4790/?k=abc");
    expect(lines).toContain("phone off");
    expect(lines).toContain("plain http");
  });
});
