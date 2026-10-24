/** One consistent stroke and optical size for all editor controls. */
export function StudioIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    play: 'm9 5 11 7-11 7Z', pause: 'M9 5v14M16 5v14',
    undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 6 6v3', redo: 'm15 5 5 5-5 5M20 10h-9a6 6 0 0 0-6 6v3',
    back: 'M5 5v14m14-14L8 12l11 7Z', forward: 'M19 5v14M5 5l11 7-11 7Z',
    volume: 'M11 4 6 8H3v8h3l5 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
    muted: 'M11 4 6 8H3v8h3l5 4ZM16 9l6 6m0-6-6 6',
    close: 'm6 6 12 12M18 6 6 18', check: 'm5 12 4 4L19 6', plus: 'M12 5v14M5 12h14', arrow: 'M5 12h14m-6-6 6 6-6 6',
    export: 'M12 16V3m-5 5 5-5 5 5M5 14v6h14v-6',
    download: 'M12 3v13m-5-5 5 5 5-5M5 17v4h14v-4',
    expand: 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6',
    minimize: 'M3 9h6V3m6 0v6h6M9 21v-6H3m18 0h-6v6',
    compare: 'M12 3v18M8 5H3v14h5m8-14h5v14h-5',
    film: 'M3 5h18v14H3ZM7 5v14M17 5v14M3 10h4m-4 4h4m10-4h4m-4 4h4',
    timeline: 'M4 6h16M4 12h10m-4 6h10M7 3v18',
    sliders: 'M4 6h7m4 0h5M4 12h1m4 0h11M4 18h10m4 0h2M11 3v6M5 9v6m9 0v6',
    chevron: 'm7 10 5 5 5-5', left: 'm14 6-6 6 6 6', right: 'm10 6 6 6-6 6',
    sparkle: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
    folder: 'M3 7V5h7l2 2h9v13H3Z', keyboard: 'M3 5h18v14H3ZM7 9h.1m4 0h.1m4 0h.1m3 0h.1M7 13h.1m4 0h.1m4 0h.1M7 16h10',
    dot: 'M12 11v2',
  };
  return <svg class="vs-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.sparkle}/></svg>;
}
