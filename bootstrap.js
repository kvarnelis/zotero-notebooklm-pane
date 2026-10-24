let chromeHandle;
let preferencePaneID;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
	const aomStartup = Components.classes[
		"@mozilla.org/addons/addon-manager-startup;1"
	].getService(Components.interfaces.amIAddonManagerStartup);

	const manifestURI = Services.io.newURI(rootURI + "manifest.json");
	chromeHandle = aomStartup.registerChrome(manifestURI, [
		["content", "zys-notebook", rootURI + "content/"],
	]);

	const ctx = {
		addonID: id,
		addonVersion: version,
		rootURI,
	};
	ctx._globalThis = ctx;

	Services.scriptloader.loadSubScript(
		rootURI + "content/scripts/notebook.js",
		ctx
	);

	await Zotero.ZysNotebook.hooks.onStartup();

	preferencePaneID = await Zotero.PreferencePanes.register({
		pluginID: id,
		src: rootURI + "content/preferences.xhtml",
		label: "NotebookLM Pane",
		image: rootURI + "content/icons/notebook.svg",
		stylesheets: [rootURI + "content/styles/notebook.css"],
	});
}

async function onMainWindowLoad({ window }, reason) {
	await Zotero.ZysNotebook?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
	await Zotero.ZysNotebook?.hooks.onMainWindowUnload(window);
}

async function shutdown({ id, version, resourceURI, rootURI }, reason) {
	if (reason === APP_SHUTDOWN) {
		return;
	}

	if (preferencePaneID) {
		Zotero.PreferencePanes.unregister(preferencePaneID);
		preferencePaneID = null;
	}

	await Zotero.ZysNotebook?.hooks.onShutdown();

	if (chromeHandle) {
		chromeHandle.destruct();
		chromeHandle = null;
	}
}

async function uninstall(data, reason) {}
