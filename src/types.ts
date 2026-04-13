export type GameCardDetailsMode = "none" | "title" | "playtime" | "both";
export type GameSource = "steam" | "custom";

export interface SteamGame {
	appId: number;
	source: GameSource;
	steamAppId?: number | null;
	name: string;
	platform?: string | null;
	playtimeMinutes: number | null;
	lastPlayedAt: number | null;
	headerImageUrl?: string | null;
	externalUrl?: string | null;
	isManual: boolean;
	isSynced: boolean;
}

export interface TierDefinition {
	id: string;
	name: string;
	color: string;
}

export interface TierSyncSettings {
	steamApiKey: string;
	steamId: string;
	rawgApiKey: string;
	minPlaytime: number;
	excludedAppIds: number[];
	cardDetails: GameCardDetailsMode;
	cardSize: number;
	autoTierTextColor: boolean;
	games: SteamGame[];
	tiers: TierDefinition[];
	placements: Record<string, number[]>;
}

export interface LegacySteamGame {
	appid: number;
	name: string;
	playtime_forever: number;
	rtime_last_played?: number;
}

export interface SteamStoreSearchResult {
	appId: number;
	name: string;
	tinyImageUrl: string | null;
	platformLabel: string;
	storeUrl: string;
}

export interface CustomGameSearchResult {
	title: string;
	description: string | null;
	imageUrl: string | null;
	pageUrl: string | null;
	platformLabel: string | null;
}

export interface LegacyTierSyncSettings {
	steamApiKey?: string;
	steamId?: string;
	rawgApiKey?: string;
	minPlaytime?: number;
	excludedAppIds?: number[];
	cardDetails?: GameCardDetailsMode;
	cardSize?: number | "compact" | "medium" | "large";
	autoTierTextColor?: boolean;
	gamesData?: LegacySteamGame[];
	tiers?: Record<string, number[]>;
}
