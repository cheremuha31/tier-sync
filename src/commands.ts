import type TierSyncPlugin from "./main";

export function registerCommands(plugin: TierSyncPlugin): void {
	plugin.addCommand({
		id: "open-board",
		name: "Open board",
		callback: () => {
			void plugin.activateView();
		},
	});

	plugin.addCommand({
		id: "sync-library",
		name: "Sync library",
		callback: () => {
			void plugin.syncSteamLibrary({ revealView: true });
		},
	});

	plugin.addCommand({
		id: "export-markdown",
		name: "Export as Markdown",
		callback: () => {
			void plugin.exportTierListMarkdown();
		},
	});

	plugin.addCommand({
		id: "add-steam-game",
		name: "Add steam game manually",
		callback: () => {
			plugin.openAddSteamGameModal();
		},
	});

	plugin.addCommand({
		id: "add-non-steam-game",
		name: "Add custom game manually",
		callback: () => {
			plugin.openAddCustomGameModal();
		},
	});
}
