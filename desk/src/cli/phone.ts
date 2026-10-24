import qrcode from "qrcode-generator";
import type { LanInfo } from "../server/lan.js";

/** The QR code as text, for a terminal. */
export function qrText(url: string): string {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  return qr.createASCII(2, 2);
}

/** What `yap-machine-desk phone` and `serve --lan` print. */
export function describeLan(info: LanInfo): string[] {
  if (!info.on || !info.links.length) return ["Phone access is off."];
  const [first, ...rest] = info.links;
  return [
    "Open this on your phone, on the same Wi-Fi as this computer:",
    "",
    qrText(first.url),
    `  ${first.url}`,
    ...(rest.length ? ["", "Other ways to reach it:", ...rest.map((l) => `  ${l.url}   (${l.label.toLowerCase()})`)] : []),
    "",
    "Anyone on this network with the link can see your cuts and leave notes until you stop sharing",
    "(yap-machine-desk phone off) or stop the desk. Use home or trusted Wi-Fi: the link is plain http.",
  ];
}
