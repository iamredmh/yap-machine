// The engine's reference face. A scene sizes type for this face, not a real one: a font size of 100 means a cap height
// of 70 and an x-height of 50, with ascent 92 and descent 26 in its line box. Each pack face is scaled to stand like it
// (its VoiceLayout `match`), so a scene drawn once lays out the same in every pack.
export const REFERENCE = { capHeight: 0.7, xHeight: 0.5, ascent: 0.92, descent: 0.26, lineGap: 0 } as const;
