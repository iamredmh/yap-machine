import { useRef } from "preact/hooks";

/** A pill menu that hands the keyboard back to the shortcuts when a value was picked with the mouse; arrow-key changes keep the focus. */
export function KeySelect(p: { id?: string; label: string; title?: string; value: string; options: { value: string; label: string }[]; onPick(value: string): void; class?: string }) {
  const typed = useRef(false);
  return (
    <select id={p.id} class={"select " + (p.class ?? "")} aria-label={p.label} title={p.title} value={p.value}
      onKeyDown={() => { typed.current = true; }} onBlur={() => { typed.current = false; }}
      onChange={(e) => { const el = e.target as HTMLSelectElement; p.onPick(el.value); if (!typed.current) el.blur(); }}>
      {p.options.map((o) => <option value={o.value}>{o.label}</option>)}
    </select>
  );
}
