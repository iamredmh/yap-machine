/** What a version chip says under its name: "latest", a short line from the agent's notes, or the length. No logic in the components. */

/** The agent's notes for a version, without the "v3: " or "v3 = " it often starts with, as one line. */
export function fullLabel(notes: string | undefined | null): string {
  return (notes ?? "").replace(/^\s*v\d+\s*[:=]?\s*/i, "").replace(/\s+/g, " ").trim();
}

const MAX = 26;

/**
 * "latest" for the newest, else the first clause of the notes cut at a word (never in the middle of one, with an ellipsis when
 * something was left out), else the length. The whole text is the chip's title.
 */
export function versionLabel(latest: boolean, notes: string | undefined | null, length: string): string {
  if (latest) return "latest";
  const full = fullLabel(notes);
  if (!full) return length;
  const clause = full.split(/\s*(?::|;|\.\s|\s[—–-]\s|\s=\s)/)[0].trim() || full;
  if (clause.length <= MAX) return clause + (clause.length < full.length ? "…" : "");
  // cut at the last space that fits, then drop a dangling joining word ("and", "the") and punctuation
  const head = clause.slice(0, MAX + 1);
  const at = head.lastIndexOf(" ");
  let cut = at > 0 ? head.slice(0, at) : clause.slice(0, MAX);
  cut = cut.replace(/(\s+(and|or|the|a|an|to|of|with|for|in|on|at|by))+$/i, "").replace(/[\s,;:+=-]+$/, "");
  return cut + "…";
}
