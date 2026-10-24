import { useMemo } from "preact/hooks";
import qrcode from "qrcode-generator";

/** A QR code drawn as one SVG path, black on white with the quiet zone it needs. Made here; the link never leaves this page. */
export function Qr({ text, label }: { text: string; label: string }) {
  const { n, d } = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { n, d };
  }, [text]);
  return (
    <svg class="qr" viewBox={`-4 -4 ${n + 8} ${n + 8}`} role="img" aria-label={label}>
      <rect x="-4" y="-4" width={n + 8} height={n + 8} fill="#fff" />
      <path d={d} fill="#0B0B0D" shape-rendering="crispEdges" />
    </svg>
  );
}
