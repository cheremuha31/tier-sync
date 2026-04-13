export function formatPlaytime(minutes: number | null): string {
	if (minutes === null) {
		return "";
	}

	if (minutes < 60) {
		return `${minutes} min`;
	}

	const hours = minutes / 60;
	const digits = hours >= 100 || Number.isInteger(hours) ? 0 : 1;

	return `${hours.toFixed(digits)} h`;
}

export function formatLastPlayed(timestamp: number | null): string {
	if (!timestamp) {
		return "No recent activity";
	}

	const date = new Date(timestamp * 1000);

	if (Number.isNaN(date.getTime())) {
		return "No recent activity";
	}

	return `Last played ${date.toLocaleDateString()}`;
}

export function getSteamHeaderImageUrl(appId: number): string {
	return `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
}

export function getReadableTextColor(hexColor: string): string {
	const red = Number.parseInt(hexColor.slice(1, 3), 16);
	const green = Number.parseInt(hexColor.slice(3, 5), 16);
	const blue = Number.parseInt(hexColor.slice(5, 7), 16);
	const luminance = (0.299 * red) + (0.587 * green) + (0.114 * blue);

	return luminance > 160 ? "#111827" : "#f8fafc";
}

export function slugify(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}
