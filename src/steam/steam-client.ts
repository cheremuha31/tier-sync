import { requestUrl } from "obsidian";
import type { SteamGame, SteamStoreSearchResult } from "../types";

interface SteamOwnedGame {
	appid?: number;
	name?: string;
	playtime_forever?: number;
	rtime_last_played?: number;
}

interface SteamStoreSearchItem {
	type?: string;
	name?: string;
	id?: number;
	tiny_image?: string;
	platforms?: {
		windows?: boolean;
		mac?: boolean;
		linux?: boolean;
	};
}

interface GetOwnedGamesResponse {
	response?: {
		games?: SteamOwnedGame[];
	};
}

interface StoreSearchResponse {
	items?: SteamStoreSearchItem[];
}

interface ResolveVanityUrlResponse {
	response?: {
		success?: number;
		steamid?: string;
	};
}

interface StoreAppDetailsData {
	header_image?: string;
	capsule_image?: string;
}

interface StoreAppDetailsEntry {
	success?: boolean;
	data?: StoreAppDetailsData;
}

type StoreAppDetailsResponse = Record<string, StoreAppDetailsEntry | undefined>;

const STEAM_ID_PATTERN = /^\d{17}$/;

export async function fetchOwnedGames(
	apiKey: string,
	steamIdInput: string,
	minPlaytime: number,
): Promise<{ resolvedSteamId: string; games: SteamGame[] }> {
	const trimmedApiKey = apiKey.trim();
	const identifier = parseSteamIdentifier(steamIdInput);

	if (!trimmedApiKey) {
		throw new Error("Add a Steam Web API key in settings before syncing.");
	}

	if (!identifier.value) {
		throw new Error("Add a Steam ID, vanity name, or profile URL in settings.");
	}

	const resolvedSteamId = identifier.kind === "steamId"
		? identifier.value
		: await resolveVanityUrl(trimmedApiKey, identifier.value);
	const url = buildGetOwnedGamesUrl(trimmedApiKey, resolvedSteamId, {
		includePlayedFreeGames: true,
	});
	const response = await requestUrl({ url });
	const body = response.json as GetOwnedGamesResponse;
	const rawGames = Array.isArray(body.response?.games) ? body.response.games : [];
	const games: SteamGame[] = [];

	for (const rawGame of rawGames) {
		const game = normalizeOwnedGame(rawGame);

		if (!game) {
			continue;
		}

		const playtimeMinutes = game.playtimeMinutes ?? 0;

		if (playtimeMinutes < minPlaytime) {
			continue;
		}

		games.push(game);
	}

	games.sort((left, right) =>
		left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
	);

	return {
		resolvedSteamId,
		games,
	};
}

export async function fetchOwnedGamesByAppIds(
	apiKey: string,
	steamId: string,
	appIds: number[],
): Promise<Map<number, SteamGame>> {
	const trimmedApiKey = apiKey.trim();
	const trimmedSteamId = steamId.trim();
	const normalizedAppIds = Array.from(
		new Set(
			appIds.filter((appId) => Number.isInteger(appId) && appId > 0),
		),
	);

	if (!trimmedApiKey || !trimmedSteamId || normalizedAppIds.length === 0) {
		return new Map<number, SteamGame>();
	}

	const url = buildGetOwnedGamesUrl(trimmedApiKey, trimmedSteamId, {
		includePlayedFreeGames: true,
		appIds: normalizedAppIds,
	});
	const response = await requestUrl({ url });
	const body = response.json as GetOwnedGamesResponse;
	const rawGames = Array.isArray(body.response?.games) ? body.response.games : [];
	const gamesByAppId = new Map<number, SteamGame>();

	for (const rawGame of rawGames) {
		const game = normalizeOwnedGame(rawGame);

		if (!game) {
			continue;
		}

		gamesByAppId.set(game.appId, game);
	}

	return gamesByAppId;
}

export async function searchSteamStoreGames(query: string): Promise<SteamStoreSearchResult[]> {
	const trimmedQuery = query.trim();

	if (trimmedQuery.length < 2) {
		return [];
	}

	const url = [
		"https://store.steampowered.com/api/storesearch/",
		`?term=${encodeURIComponent(trimmedQuery)}`,
		"&l=english",
		"&cc=us",
	].join("");
	const response = await requestUrl({ url });
	const body = response.json as StoreSearchResponse;
	const items = Array.isArray(body.items) ? body.items : [];
	const results: SteamStoreSearchResult[] = [];

	for (const item of items) {
		if (item.type !== "app" || typeof item.id !== "number" || !item.name) {
			continue;
		}

		results.push({
			appId: item.id,
			name: item.name,
			tinyImageUrl: normalizeImageUrl(item.tiny_image),
			platformLabel: buildPlatformLabel(item.platforms),
			storeUrl: buildSteamStoreUrl(item.id),
		});
	}

	return results;
}

export async function fetchStoreHeaderImageUrl(appId: number): Promise<string | null> {
	const url = [
		"https://store.steampowered.com/api/appdetails",
		`?appids=${encodeURIComponent(`${appId}`)}`,
		"&l=english",
	].join("");
	const response = await requestUrl({ url });
	const body = response.json as StoreAppDetailsResponse;
	const entry = body[`${appId}`];

	if (!entry?.success) {
		return null;
	}

	return normalizeImageUrl(entry.data?.header_image)
		?? normalizeImageUrl(entry.data?.capsule_image);
}

async function resolveVanityUrl(
	apiKey: string,
	vanityName: string,
): Promise<string> {
	const url = [
		"https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/",
		`?key=${encodeURIComponent(apiKey)}`,
		`&vanityurl=${encodeURIComponent(vanityName)}`,
	].join("");
	const response = await requestUrl({ url });
	const body = response.json as ResolveVanityUrlResponse;
	const resolvedSteamId = body.response?.steamid;

	if (body.response?.success !== 1 || !resolvedSteamId) {
		throw new Error(
			"Could not resolve the provided Steam vanity name or profile URL.",
		);
	}

	return resolvedSteamId;
}

function parseSteamIdentifier(input: string): {
	kind: "steamId" | "vanity";
	value: string;
} {
	const trimmedInput = input.trim();

	if (!trimmedInput) {
		return { kind: "vanity", value: "" };
	}

	if (STEAM_ID_PATTERN.test(trimmedInput)) {
		return { kind: "steamId", value: trimmedInput };
	}

	const profileMatch = trimmedInput.match(/steamcommunity\.com\/profiles\/(\d{17})/i);

	if (profileMatch?.[1]) {
		return { kind: "steamId", value: profileMatch[1] };
	}

	const vanityMatch = trimmedInput.match(/steamcommunity\.com\/id\/([^/?#]+)/i);

	if (vanityMatch?.[1]) {
		return { kind: "vanity", value: vanityMatch[1] };
	}

	return { kind: "vanity", value: trimmedInput };
}

function normalizeMinutes(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return 0;
	}

	return Math.max(0, Math.trunc(value));
}

function normalizeTimestamp(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return null;
	}

	return Math.trunc(value);
}

function normalizeImageUrl(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalizedValue = value.trim();

	return normalizedValue.length > 0 ? normalizedValue : null;
}

function buildPlatformLabel(platforms: SteamStoreSearchItem["platforms"]): string {
	if (!platforms) {
		return "Steam";
	}

	const labels: string[] = [];

	if (platforms.windows) {
		labels.push("Windows");
	}

	if (platforms.mac) {
		labels.push("Mac");
	}

	if (platforms.linux) {
		labels.push("Linux");
	}

	return labels.length > 0 ? labels.join(" / ") : "Steam";
}

function buildSteamStoreUrl(appId: number): string {
	return `https://store.steampowered.com/app/${appId}/`;
}

function normalizeOwnedGame(rawGame: SteamOwnedGame): SteamGame | null {
	if (typeof rawGame.appid !== "number" || !rawGame.name) {
		return null;
	}

	return {
		appId: rawGame.appid,
		source: "steam",
		steamAppId: rawGame.appid,
		name: rawGame.name,
		platform: "Steam",
		playtimeMinutes: normalizeMinutes(rawGame.playtime_forever),
		lastPlayedAt: normalizeTimestamp(rawGame.rtime_last_played),
		headerImageUrl: null,
		externalUrl: buildSteamStoreUrl(rawGame.appid),
		isManual: false,
		isSynced: true,
	};
}

function buildGetOwnedGamesUrl(
	apiKey: string,
	steamId: string,
	options: {
		includePlayedFreeGames: boolean;
		appIds?: number[];
	},
): string {
	const parts = [
		"https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/",
		`?key=${encodeURIComponent(apiKey)}`,
		`&steamid=${encodeURIComponent(steamId)}`,
		"&include_appinfo=1",
		`&include_played_free_games=${options.includePlayedFreeGames ? 1 : 0}`,
		"&format=json",
	];

	for (const [index, appId] of (options.appIds ?? []).entries()) {
		parts.push(`&appids_filter[${index}]=${encodeURIComponent(`${appId}`)}`);
	}

	return parts.join("");
}
