/** Bound the visible rows without a nested scrollbar or an unbounded loss of video space. */
export function timelinePage(count: number, requested: number, size = 3) {
  const page = Math.max(0, Math.min(requested, Math.max(0, Math.ceil(count / size) - 1)));
  return { page, start: page * size, end: Math.min(count, (page + 1) * size) };
}
