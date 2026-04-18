import { BACKLOG_TIER_ID, DEFAULT_TIER_COLORS, DEFAULT_TIERS } from "./constants";
import type {
	GameCardDetailsMode,
	GameSource,
	LegacySteamGame,
	SteamGame,
	TierDefinition,
	TierSyncSettings,
} from "./types";
import { slugify } from "./utils";

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const DEFAULT_MIN_PLAYTIME = 120;

export function createDefaultSettings(): TierSyncSettings {
	const tiers = cloneTierDefinitions(DEFAULT_TIERS);

	return {
		steamApiKey: "",
		steamId: "",
		rawgApiKey: "",
		minPlaytime: DEFAULT_MIN_PLAYTIME,
		excludedAppIds: [],
		cardDetails: "title",
		cardSize: 100,
		autoTierTextColor: true,
		games: [],
		tiers,
		placements: createEmptyPlacements(tiers),
	};
}

export function migrateBoardData(data: unknown): Pick<
	TierSyncSettings,
	"minPlaytime" | "excludedAppIds" | "games" | "tiers" | "placements"
> {
	const defaults = createDefaultSettings();
	const raw = isRecord(data) ? data : undefined;

	if (!raw) {
		return {
			minPlaytime: defaults.minPlaytime,
			excludedAppIds: defaults.excludedAppIds,
			games: defaults.games,
			tiers: defaults.tiers,
			placements: defaults.placements,
		};
	}

	const legacyTierData = isRecord(raw.tiers) && !Array.isArray(raw.tiers)
		? buildLegacyTierData(raw.tiers)
		: undefined;
	const tiers = Array.isArray(raw.tiers)
		? normalizeTierDefinitions(raw.tiers)
		: legacyTierData?.tiers ?? defaults.tiers;
	const games = normalizeGames(raw.games, raw.gamesData);
	const validGameIds = games.length > 0 ? buildGameIdSet(games) : undefined;
	const rawPlacements = isRecord(raw.placements)
		? raw.placements
		: legacyTierData?.placements;

	return {
		minPlaytime: readNonNegativeInteger(raw.minPlaytime, DEFAULT_MIN_PLAYTIME),
		excludedAppIds: normalizeExcludedAppIds(raw.excludedAppIds),
		games,
		tiers,
		placements: normalizePlacements(rawPlacements, tiers, validGameIds),
	};
}

export function migrateSettings(data: unknown): TierSyncSettings {
	const defaults = createDefaultSettings();
	const raw = isRecord(data) ? data : undefined;

	if (!raw) {
		return defaults;
	}

	return {
		steamApiKey: readString(raw.steamApiKey),
		steamId: readString(raw.steamId),
		rawgApiKey: readString(raw.rawgApiKey),
		cardDetails: normalizeCardDetailsMode(raw.cardDetails),
		cardSize: normalizeCardSize(raw.cardSize),
		autoTierTextColor: readBoolean(raw.autoTierTextColor, true),
		...migrateBoardData(raw),
	};
}

export function parseExcludedAppIds(input: string): number[] {
	const values = input
		.split(/[^\d]+/u)
		.map((value) => Number.parseInt(value, 10))
		.filter((value) => Number.isFinite(value) && value > 0);

	return normalizeExcludedAppIds(values);
}

export function formatExcludedAppIds(appIds: number[]): string {
	return appIds.join(", ");
}

export function normalizePlacements(
	rawPlacements: unknown,
	tiers: TierDefinition[],
	validGameIds?: Set<number>,
): Record<string, number[]> {
	const placements: Record<string, unknown> = isRecord(rawPlacements)
		? rawPlacements
		: {};
	const normalized: Record<string, number[]> = {};
	const seen = new Set<number>();

	for (const tier of tiers) {
		normalized[tier.id] = normalizeIdList(
			placements[tier.id],
			seen,
			validGameIds,
		);
	}

	return normalized;
}

export function createTierDefinition(
	name: string,
	existingTiers: TierDefinition[],
	preferredColor?: string,
): TierDefinition {
	const existingIds = new Set<string>();

	for (const tier of existingTiers) {
		existingIds.add(tier.id);
	}

	const fallbackName = createNextTierName(existingTiers);
	const normalizedName = name.trim() || fallbackName;
	const baseId = normalizedName.toLowerCase() === "backlog"
		? BACKLOG_TIER_ID
		: slugify(normalizedName) || `tier-${existingTiers.length + 1}`;

	return {
		id: uniqueTierId(baseId, existingIds),
		name: normalizedName,
		color: normalizeColor(
			preferredColor,
			getDefaultTierColor(existingTiers.length),
		),
	};
}

export function createNextTierName(existingTiers: TierDefinition[]): string {
	const usedNames = new Set<string>();

	for (const tier of existingTiers) {
		usedNames.add(tier.name.toLowerCase());
	}

	let index = 1;

	while (true) {
		const candidate = index === 1 ? "New tier" : `New tier ${index}`;

		if (!usedNames.has(candidate.toLowerCase())) {
			return candidate;
		}

		index += 1;
	}
}

export function findFallbackTierId(
	tiers: TierDefinition[],
	excludedTierId: string,
): string | null {
	for (const tier of tiers) {
		if (tier.id === BACKLOG_TIER_ID && tier.id !== excludedTierId) {
			return tier.id;
		}
	}

	for (const tier of tiers) {
		if (tier.id !== excludedTierId) {
			return tier.id;
		}
	}

	return null;
}

export function moveTier(
	tiers: TierDefinition[],
	tierId: string,
	direction: -1 | 1,
): TierDefinition[] {
	const currentIndex = tiers.findIndex((tier) => tier.id === tierId);
	const targetIndex = currentIndex + direction;

	if (
		currentIndex === -1 ||
		targetIndex < 0 ||
		targetIndex >= tiers.length
	) {
		return tiers.slice();
	}

	const nextTiers = tiers.slice();
	const currentTier = nextTiers[currentIndex];
	const targetTier = nextTiers[targetIndex];

	if (!currentTier || !targetTier) {
		return tiers.slice();
	}

	nextTiers[currentIndex] = targetTier;
	nextTiers[targetIndex] = currentTier;

	return nextTiers;
}

export function buildGameIdSet(games: SteamGame[]): Set<number> {
	const ids = new Set<number>();

	for (const game of games) {
		ids.add(game.appId);
	}

	return ids;
}

function createEmptyPlacements(tiers: TierDefinition[]): Record<string, number[]> {
	const placements: Record<string, number[]> = {};

	for (const tier of tiers) {
		placements[tier.id] = [];
	}

	return placements;
}

function cloneTierDefinitions(tiers: TierDefinition[]): TierDefinition[] {
	return tiers.map((tier) => ({ ...tier }));
}

function normalizeGames(
	currentGames: unknown,
	legacyGames: unknown,
): SteamGame[] {
	if (Array.isArray(currentGames)) {
		return normalizeCurrentGames(currentGames);
	}

	if (Array.isArray(legacyGames)) {
		return normalizeLegacyGames(legacyGames);
	}

	return [];
}

function normalizeCurrentGames(games: unknown[]): SteamGame[] {
	const normalized: SteamGame[] = [];
	const seenIds = new Set<number>();

	for (const value of games) {
		if (!isRecord(value)) {
			continue;
		}

		const game = normalizeCurrentGameRecord(value);

		if (!game || seenIds.has(game.appId)) {
			continue;
		}

		seenIds.add(game.appId);
		normalized.push(game);
	}

	return normalized;
}

function normalizeLegacyGames(games: unknown[]): SteamGame[] {
	const normalized: SteamGame[] = [];
	const seenIds = new Set<number>();

	for (const value of games) {
		if (!isRecord(value)) {
			continue;
		}

		const legacyGame = value as Partial<LegacySteamGame>;
		const appId = readPositiveInteger(legacyGame.appid, -1);
		const name = readString(legacyGame.name).trim();

		if (appId < 0 || name.length === 0) {
			continue;
		}

		const game: SteamGame = {
			appId,
			source: "steam",
			steamAppId: appId,
			name,
			platform: "Steam",
			playtimeMinutes: readOptionalNonNegativeInteger(
				legacyGame.playtime_forever,
				0,
			),
			lastPlayedAt: readOptionalTimestamp(legacyGame.rtime_last_played),
			headerImageUrl: null,
			externalUrl: null,
			isManual: false,
			isSynced: true,
		};

		if (seenIds.has(game.appId)) {
			continue;
		}

		seenIds.add(game.appId);
		normalized.push(game);
	}

	return normalized;
}

function normalizeCurrentGameRecord(value: Record<string, unknown>): SteamGame | null {
	const source = normalizeGameSource(value.source);
	const steamAppId = source === "steam"
		? readPositiveInteger(value.steamAppId ?? value.appId, -1)
		: null;
	const fallbackAppId = steamAppId ?? -1;
	const appId = readPositiveInteger(value.appId, fallbackAppId);
	const name = readString(value.name).trim();

	if (appId < 0 || name.length === 0) {
		return null;
	}

	return {
		appId,
		source,
		steamAppId,
		name,
		platform: readOptionalString(value.platform) ?? (source === "steam" ? "Steam" : null),
		playtimeMinutes: readOptionalNonNegativeInteger(
			value.playtimeMinutes,
			source === "steam" ? 0 : null,
		),
		lastPlayedAt: readOptionalTimestamp(value.lastPlayedAt),
		headerImageUrl: readOptionalString(value.headerImageUrl),
		externalUrl: readOptionalString(value.externalUrl),
		isManual: readBoolean(value.isManual, source === "custom"),
		isSynced: source === "steam"
			? readBoolean(value.isSynced, true)
			: false,
	};
}

function normalizeTierDefinitions(rawTiers: unknown[]): TierDefinition[] {
	const tiers: TierDefinition[] = [];
	const usedIds = new Set<string>();

	for (const value of rawTiers) {
		if (!isRecord(value)) {
			continue;
		}

		const name = readString(value.name).trim() || `Tier ${tiers.length + 1}`;
		const rawId = readString(value.id).trim();
		const baseId = rawId || slugify(name) || `tier-${tiers.length + 1}`;
		const preferredBaseId = name.toLowerCase() === "backlog"
			? BACKLOG_TIER_ID
			: baseId;

		tiers.push({
			id: uniqueTierId(preferredBaseId, usedIds),
			name,
			color: normalizeColor(
				value.color,
				getDefaultTierColor(tiers.length),
			),
		});
	}

	return tiers.length > 0 ? tiers : cloneTierDefinitions(DEFAULT_TIERS);
}

function buildLegacyTierData(rawTiers: Record<string, unknown>): {
	tiers: TierDefinition[];
	placements: Record<string, unknown>;
} {
	const tiers: TierDefinition[] = [];
	const placements: Record<string, unknown> = {};
	const usedIds = new Set<string>();
	const entries = Object.entries(rawTiers);
	let index = 0;

	for (const [rawName, ids] of entries) {
		const name = rawName.trim() || `Tier ${index + 1}`;
		const preferredBaseId = name.toLowerCase() === "backlog"
			? BACKLOG_TIER_ID
			: slugify(name) || `tier-${index + 1}`;
		const tierId = uniqueTierId(preferredBaseId, usedIds);

		tiers.push({
			id: tierId,
			name,
			color: normalizeColor(
				undefined,
				getDefaultTierColor(index),
			),
		});
		placements[tierId] = ids;
		index += 1;
	}

	if (tiers.length === 0) {
		return {
			tiers: cloneTierDefinitions(DEFAULT_TIERS),
			placements: createEmptyPlacements(DEFAULT_TIERS),
		};
	}

	return { tiers, placements };
}

function normalizeIdList(
	rawValue: unknown,
	seen: Set<number>,
	validGameIds?: Set<number>,
): number[] {
	if (!Array.isArray(rawValue)) {
		return [];
	}

	const ids: number[] = [];

	for (const item of rawValue) {
		const id = readPositiveInteger(item, -1);

		if (id < 0 || seen.has(id)) {
			continue;
		}

		if (validGameIds && !validGameIds.has(id)) {
			continue;
		}

		seen.add(id);
		ids.push(id);
	}

	return ids;
}

function normalizeColor(value: unknown, fallbackColor: string): string {
	const color = typeof value === "string" ? value.trim() : "";

	return HEX_COLOR_PATTERN.test(color) ? color.toLowerCase() : fallbackColor;
}

function uniqueTierId(baseId: string, usedIds: Set<string>): string {
	let candidate = baseId;
	let index = 2;

	while (usedIds.has(candidate)) {
		candidate = `${baseId}-${index}`;
		index += 1;
	}

	usedIds.add(candidate);

	return candidate;
}

function getDefaultTierColor(index: number): string {
	return DEFAULT_TIER_COLORS[index % DEFAULT_TIER_COLORS.length] ?? "#6cb6ff";
}

function normalizeExcludedAppIds(rawValue: unknown): number[] {
	if (!Array.isArray(rawValue)) {
		return [];
	}

	const values = new Set<number>();

	for (const value of rawValue) {
		const appId = readNonNegativeInteger(value, -1);

		if (appId > 0) {
			values.add(appId);
		}
	}

	return Array.from(values).sort((left, right) => left - right);
}

function normalizeCardDetailsMode(value: unknown): GameCardDetailsMode {
	switch (value) {
		case "none":
		case "title":
		case "playtime":
		case "both":
			return value;
		default:
			return "title";
	}
}

function normalizeCardSize(value: unknown): number {
	switch (value) {
		case "compact":
			return 86;
		case "medium":
			return 100;
		case "large":
			return 118;
		default:
			if (typeof value === "number" && Number.isFinite(value)) {
				return clampCardSize(value);
			}

			return 100;
	}
}

function clampCardSize(value: number): number {
	return Math.max(70, Math.min(400, Math.round(value)));
}

function normalizeGameSource(value: unknown): GameSource {
	return value === "custom" ? "custom" : "steam";
}

function readString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function readOptionalString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalizedValue = value.trim();

	return normalizedValue.length > 0 ? normalizedValue : null;
}

function readNonNegativeInteger(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}

	return Math.max(0, Math.trunc(value));
}

function readPositiveInteger(value: unknown, fallback: number): number {
	const normalizedValue = readNonNegativeInteger(value, fallback);

	return normalizedValue > 0 ? normalizedValue : fallback;
}

function readOptionalNonNegativeInteger(
	value: unknown,
	fallback: number | null,
): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}

	return Math.max(0, Math.trunc(value));
}

function readOptionalTimestamp(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return null;
	}

	return Math.trunc(value);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
