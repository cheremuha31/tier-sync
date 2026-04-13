import { requestUrl } from "obsidian";
import type { CustomGameSearchResult } from "../types";

interface RawgPlatform {
	name?: string;
}

interface RawgPlatformEntry {
	platform?: RawgPlatform;
}

interface RawgGameResult {
	name?: string;
	slug?: string;
	background_image?: string;
	background_image_additional?: string;
	platforms?: RawgPlatformEntry[];
}

interface RawgSearchResponse {
	results?: RawgGameResult[];
}

const MAX_RESULTS = 8;

export async function searchRawgGames(
	apiKey: string,
	query: string,
): Promise<CustomGameSearchResult[]> {
	const trimmedApiKey = apiKey.trim();
	const trimmedQuery = query.trim();

	if (!trimmedApiKey) {
		throw new Error("Add a RAWG API key in settings before searching custom games.");
	}

	if (trimmedQuery.length < 2) {
		return [];
	}

	const url = [
		"https://api.rawg.io/api/games",
		`?key=${encodeURIComponent(trimmedApiKey)}`,
		`&search=${encodeURIComponent(trimmedQuery)}`,
		"&search_precise=true",
		`&page_size=${MAX_RESULTS}`,
	].join("");
	const response = await requestUrl({ url });
	const body = response.json as RawgSearchResponse;
	const results = Array.isArray(body.results) ? body.results : [];

	return results
		.map((result) => normalizeRawgResult(result))
		.filter((result): result is CustomGameSearchResult => result !== null);
}

function normalizeRawgResult(result: RawgGameResult): CustomGameSearchResult | null {
	const title = normalizeString(result.name);

	if (!title) {
		return null;
	}

	const slug = normalizeString(result.slug);

	return {
		title,
		description: buildDescription(result.platforms),
		imageUrl: normalizeString(result.background_image)
			?? normalizeString(result.background_image_additional),
		pageUrl: slug ? `https://rawg.io/games/${slug}` : null,
		platformLabel: buildPlatformLabel(result.platforms),
	};
}

function buildDescription(platforms: RawgPlatformEntry[] | undefined): string | null {
	const platformLabel = buildPlatformLabel(platforms);

	return platformLabel ? `RAWG | ${platformLabel}` : "RAWG";
}

function buildPlatformLabel(platforms: RawgPlatformEntry[] | undefined): string | null {
	if (!Array.isArray(platforms) || platforms.length === 0) {
		return null;
	}

	const names = new Set<string>();

	for (const entry of platforms) {
		const name = normalizeString(entry.platform?.name);

		if (name) {
			names.add(name);
		}
	}

	if (names.size === 0) {
		return null;
	}

	return Array.from(names).slice(0, 4).join(" / ");
}

function normalizeString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalizedValue = value.trim();

	return normalizedValue.length > 0 ? normalizedValue : null;
}
