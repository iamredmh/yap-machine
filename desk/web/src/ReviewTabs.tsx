import { useRef } from "preact/hooks";

export type ReviewTabId = "transcript" | "notes" | "checks" | "left";

export interface ReviewTabItem {
  id: ReviewTabId;
  label: string;
  badge?: { count: number; title?: string; tone?: "bad" | "warn" };
}

export interface ReviewTabsProps {
  value: ReviewTabId;
  items: readonly ReviewTabItem[];
  onChange(tab: ReviewTabId): void;
}

/** The active panel uses review-panel-${value} and aria-labelledby review-tab-${value}. */
export function ReviewTabs({ value, items, onChange }: ReviewTabsProps) {
  const tabs = useRef<HTMLDivElement>(null);

  return <div class="side-tabs" role="tablist" aria-label="Review tools" ref={tabs}>
    {items.map((item, index) => <button
      key={item.id}
      id={`review-tab-${item.id}`}
      type="button"
      role="tab"
      aria-selected={value === item.id}
      aria-controls={`review-panel-${item.id}`}
      tabIndex={value === item.id ? 0 : -1}
      onClick={() => onChange(item.id)}
      onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (index + 1) % items.length
          : event.key === "ArrowLeft" ? (index + items.length - 1) % items.length
          : event.key === "Home" ? 0
          : event.key === "End" ? items.length - 1
          : -1;
        if (next < 0) return;
        event.preventDefault();
        event.stopPropagation();
        onChange(items[next].id);
        tabs.current?.querySelector<HTMLButtonElement>(`#review-tab-${items[next].id}`)?.focus();
      }}
    >
      {item.label}
      {item.badge && item.badge.count > 0 && <span class={`n${item.badge.tone ? ` ${item.badge.tone}` : ""}`} title={item.badge.title}>{item.badge.count}</span>}
    </button>)}
  </div>;
}
