import type { TierDefinition } from "./types";

export const VIEW_TYPE_TIER_SYNC = "tier-sync-view";
export const BACKLOG_TIER_ID = "backlog";
export const UNASSIGNED_SECTION_ID = "__unassigned__";

export const DEFAULT_TIER_COLORS = [
	"#ff6b6b",
	"#ffb454",
	"#ffe066",
	"#84d98f",
	"#6cb6ff",
	"#b197fc",
] as const;

export const DEFAULT_TIERS: TierDefinition[] = [
	{ id: "s", name: "S", color: DEFAULT_TIER_COLORS[0] },
	{ id: "a", name: "A", color: DEFAULT_TIER_COLORS[1] },
	{ id: "b", name: "B", color: DEFAULT_TIER_COLORS[2] },
	{ id: "c", name: "C", color: DEFAULT_TIER_COLORS[3] },
	{ id: BACKLOG_TIER_ID, name: "Backlog", color: DEFAULT_TIER_COLORS[4] },
];
