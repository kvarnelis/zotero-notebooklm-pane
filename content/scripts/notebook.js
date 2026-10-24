function resolveNotebookPanelPrefs(prefsLike) {
	const read = (key) => {
		try {
			return typeof prefsLike?.get === "function"
				? prefsLike.get(key)
				: prefsLike?.[key];
		}
		catch (_) {
			return undefined;
		}
	};
	const booleanOrDefault = (value) => typeof value === "boolean" ? value : true;
	return {
		mini: booleanOrDefault(read("zysNotebook.ui.miniPanel")),
		full: booleanOrDefault(read("zysNotebook.ui.fullPanel")),
	};
}

var ZysNotebook = {
	addonID,
	version: typeof addonVersion === "string" ? addonVersion : "",
	rootURI,
	BUILD_ID: "0.4.1+20260716",
	ACTOR_NAME: "ZysNotebook",
	HOME_URL: "https://notebooklm.google.com/",
	PREF_LAST_URL: "zysNotebook.lastURL",
	PREF_UI_MINI_PANEL: "zysNotebook.ui.miniPanel",
	PREF_UI_FULL_PANEL: "zysNotebook.ui.fullPanel",
	PREF_UI_MINI_HIDDEN: "zysNotebook.ui.miniHidden",
	PANE_ID: "zys-notebook-pane",
	SECTION_PANE_ID: "zys-notebook-mini",
	BUTTON_ID: "zys-notebook-sidenav-btn",
	DIVIDER_ID: "zys-notebook-sidenav-divider",
	windows: new Map(),
	miniBodies: new Set(),
	notebookPaneID: null,
	sectionRetryTimer: null,
	panelPrefObservers: [],

	hooks: {
		onStartup: async () => {
			Zotero.ZysNotebook = ZysNotebook;
			Zotero.debug(`NotebookLM Pane: startup (build ${ZysNotebook.BUILD_ID})`);
			ZysNotebook.initializePanelPrefs();
			ZysNotebook.registerPanelPrefObservers();
			ZysNotebook.registerActor();
			ZysNotebook.registerEndpoint();
			if (ZysNotebook.getPanelPrefs().mini) {
				ZysNotebook.registerNotebookSection();
			}
			const win = Zotero.getMainWindow?.();
			if (win) {
				ZysNotebook.patchWindow(win);
			}
		},

		onMainWindowLoad: async (win) => {
			Zotero.debug("NotebookLM Pane: main window load");
			ZysNotebook.patchWindow(win);
		},

		onMainWindowUnload: async (win) => {
			ZysNotebook.unpatchWindow(win);
		},

		onShutdown: async () => {
			for (let win of Array.from(ZysNotebook.windows.keys())) {
				ZysNotebook.unpatchWindow(win);
			}
			ZysNotebook.unregisterPanelPrefObservers();
			ZysNotebook.unregisterActor();
			ZysNotebook.unregisterEndpoint();
			ZysNotebook.unregisterNotebookSection();
			delete Zotero.ZysNotebook;
		},
	},

	ENDPOINT_PATH: "/zys-notebook/diag",
	endpointRetryTimer: null,

	initPreferencesPane(root) {
		const doc = root?.ownerDocument;
		const version = doc?.getElementById("zys-notebook-preferences-version");
		if (version) {
			version.textContent = this.version || this.BUILD_ID;
		}
	},

	getPanelPrefs() {
		return resolveNotebookPanelPrefs(Zotero.Prefs);
	},

	initializePanelPrefs() {
		const prefs = this.getPanelPrefs();
		Zotero.Prefs.set(this.PREF_UI_MINI_PANEL, prefs.mini);
		Zotero.Prefs.set(this.PREF_UI_FULL_PANEL, prefs.full);
	},

	registerPanelPrefObservers() {
		if (this.panelPrefObservers.length) {
			return;
		}
		const apply = () => {
			try {
				this.applyPanelPrefs();
			}
			catch (e) {
				Zotero.debug(`NotebookLM Pane: applying panel preferences failed: ${e}`);
			}
		};
		for (const key of [this.PREF_UI_MINI_PANEL, this.PREF_UI_FULL_PANEL]) {
			this.panelPrefObservers.push(Zotero.Prefs.registerObserver(key, apply));
		}
	},

	unregisterPanelPrefObservers() {
		for (const observer of this.panelPrefObservers.splice(0)) {
			try {
				Zotero.Prefs.unregisterObserver(observer);
			}
			catch (_) {}
		}
	},

	applyPanelPrefs() {
		const prefs = this.getPanelPrefs();
		if (prefs.mini) {
			this.registerNotebookSection();
		}
		else {
			this.unregisterNotebookSection();
		}

		for (const win of this.windows.keys()) {
			this.applyFullPanelPref(win);
		}
		for (const body of this.getMiniBodies()) {
			const expand = body.querySelector?.(".zys-notebook-mini-expand");
			if (expand) {
				expand.hidden = !prefs.full;
			}
		}
	},

	registerEndpoint() {
		if (!Zotero.Server?.Endpoints) {
			this.endpointRetryTimer = setTimeout(() => this.registerEndpoint(), 250);
			return;
		}
		const self = this;
		const Endpoint = function () {};
		Endpoint.prototype = {
			supportedMethods: ["GET", "POST"],
			supportedDataTypes: ["application/json"],
			init: async function (requestData) {
				try {
					const win = Zotero.getMainWindow();
					const state = self.windows.get(win);
					const action
						= requestData.method === "POST"
							? requestData.data?.action || ""
							: "status";
					const doc = win?.document;
					const deck = doc?.getElementById("zotero-item-pane-content");
					const status = {
						build: self.BUILD_ID,
						patched: self.windows.has(win),
						button: !!doc?.getElementById(self.BUTTON_ID),
						sidenav: !!doc?.getElementById("zotero-view-item-sidenav"),
						itemPane: !!doc?.getElementById("zotero-item-pane"),
						deckParent: deck?.parentElement?.id || null,
						panelCreated: !!(state?.surfaces?.library?.pane || state?.surfaces?.reader?.pane),
						activeSurface: state?.activeSurface || null,
						panelOpen: !!state?.activeSurface,
						takeover: Zotero.ZysTakeover?.active?.(win) || null,
						visibility: (() => {
							try {
								const out = {};
								for (const s of ["library", "reader"]) {
									const surface = Zotero.ZysTakeover.getSurface(win, s);
									out[s] = {
										hideElHidden: !!surface.hideEl?.hidden,
										panes: Array.from(
											surface.container?.querySelectorAll(
												":scope > .zys-takeover-pane"
											) || []
										).map(el => `${el.id}:${el.hidden ? "hidden" : "VISIBLE"}`),
									};
								}
								return out;
							}
							catch (e) {
								return String(e);
							}
						})(),
						browserURL: state?.browser?.currentURI?.spec || null,
					};
					if (action === "status") {
						return [200, "application/json", JSON.stringify(status)];
					}
					if (action === "toggle") {
						self.toggle(win);
						return [200, "application/json", JSON.stringify({ ok: true })];
					}
					return [400, "application/json", JSON.stringify({ error: "unknown action" })];
				}
				catch (e) {
					return [500, "application/json", JSON.stringify({ error: String(e) })];
				}
			},
		};
		Zotero.Server.Endpoints[this.ENDPOINT_PATH] = Endpoint;
		Zotero.debug(`NotebookLM Pane: registered ${this.ENDPOINT_PATH}`);
	},

	unregisterEndpoint() {
		if (this.endpointRetryTimer) {
			clearTimeout(this.endpointRetryTimer);
			this.endpointRetryTimer = null;
		}
		if (Zotero.Server?.Endpoints?.[this.ENDPOINT_PATH]) {
			delete Zotero.Server.Endpoints[this.ENDPOINT_PATH];
		}
	},

	// The embedded NotebookLM app is global (one shared browser), not per-item,
	// so the mini section is always enabled and its summary is fixed.
	registerNotebookSection() {
		if (this.notebookPaneID) {
			return;
		}
		if (!Zotero.ItemPaneManager?.registerSection) {
			this.sectionRetryTimer = setTimeout(() => this.registerNotebookSection(), 250);
			return;
		}
		const icon = "chrome://zys-notebook/content/icons/notebook.svg";
		const paneID = Zotero.ItemPaneManager.registerSection({
			paneID: this.SECTION_PANE_ID,
			pluginID: this.addonID,
			header: {
				l10nID: "zys-notebook-header",
				label: "NotebookLM",
				icon,
			},
			sidenav: {
				l10nID: "zys-notebook-sidenav",
				label: "NotebookLM",
				icon,
				orderable: true,
			},
			bodyXHTML: '<html:div class="zys-notebook-mini"></html:div>',
			onInit: (props) => this.setNotebookSectionLabel(props.body),
			onItemChange: (props) => this.handleNotebookItemChange(props),
			onRender: (props) => this.renderNotebookSection(props),
		});
		if (paneID) {
			this.notebookPaneID = paneID;
			Zotero.debug(`NotebookLM Pane: registered mini section ${paneID}`);
		}
	},

	unregisterNotebookSection() {
		if (this.sectionRetryTimer) {
			clearTimeout(this.sectionRetryTimer);
			this.sectionRetryTimer = null;
		}
		if (this.notebookPaneID && Zotero.ItemPaneManager?.unregisterSection) {
			Zotero.ItemPaneManager.unregisterSection(this.notebookPaneID);
			this.notebookPaneID = null;
		}
		this.miniBodies.clear();
	},

	setNotebookSectionLabel(body) {
		const section = body?.closest?.("collapsible-section");
		if (!section) {
			return;
		}
		section.label = "NotebookLM";
		section.setAttribute("label", "NotebookLM");
		section.classList.toggle("zys-notebook-mini-hidden", this.isMiniHidden());
	},

	// The mini section's sidenav button is Zotero's own and only scrolls to the
	// section. Make it a real toggle: hiding sets a pref (shared by the library
	// item pane and the reader context pane) and display:nones the section. The
	// section stays "enabled" so its button stays in the strip; setEnabled(false)
	// would remove the button as well. The shared browser is only hidden, never
	// removed, so the NotebookLM session is kept.
	isMiniHidden() {
		return this.getPref(this.PREF_UI_MINI_HIDDEN, false) === true;
	},

	getMiniPaneID() {
		return this.notebookPaneID || this.addonID + "-" + this.SECTION_PANE_ID;
	},

	applyMiniHidden(win = null) {
		const hidden = this.isMiniHidden();
		for (const body of this.getMiniBodies()) {
			body.closest?.("collapsible-section")?.classList.toggle("zys-notebook-mini-hidden", hidden);
		}
		for (const w of win ? [win] : this.windows.keys()) {
			for (const id of ["zotero-view-item-sidenav", "zotero-context-pane-sidenav"]) {
				const sidenav = w.document.getElementById(id);
				if (sidenav) {
					sidenav.classList.toggle("zys-notebook-mini-off", hidden);
				}
			}
		}
	},

	installMiniToggle(win) {
		const state = this.windows.get(win);
		if (!state || state.miniToggleTimer || state.miniToggleListeners.length) {
			return;
		}
		const tryInstall = () => {
			state.miniToggleTimer = null;
			if (!this.windows.has(win)) {
				return;
			}
			const doc = win.document;
			const sidenavs = ["zotero-view-item-sidenav", "zotero-context-pane-sidenav"]
				.map(id => doc.getElementById(id));
			if (!sidenavs[0]) {
				state.miniToggleTimer = win.setTimeout(tryInstall, 250);
				return;
			}
			for (const sidenav of sidenavs.filter(Boolean)) {
				// Capture phase on the sidenav runs before Zotero's own click
				// handler (also on the sidenav), and survives sidenav re-renders
				// because it matches the button by data-pane at click time.
				const listener = (event) => {
					const btn = event.target.closest?.(".btn[data-pane]");
					if (!btn || btn.dataset.pane !== this.getMiniPaneID()) {
						return;
					}
					if (event.button !== 0) {
						return;
					}
					const wasHidden = this.isMiniHidden();
					if (event.detail > 1) {
						// Second click of a double-click: Zotero would pin the pane.
						event.stopPropagation();
						return;
					}
					this.savePref(this.PREF_UI_MINI_HIDDEN, !wasHidden);
					this.applyMiniHidden();
					if (!wasHidden) {
						// Now hidden: do not let Zotero scroll to the section.
						event.stopPropagation();
					}
					// Now shown: let Zotero's handler scroll to it.
				};
				sidenav.addEventListener("click", listener, true);
				state.miniToggleListeners.push({ sidenav, listener });
			}
			this.applyMiniHidden(win);
		};
		tryInstall();
	},

	handleNotebookItemChange({ setEnabled, setSectionSummary }) {
		setEnabled(true);
		setSectionSummary("NotebookLM");
	},

	// Live mini section bodies, pruned of any removed from their documents.
	// Section bodies live in shadow DOM, so we can't querySelector for them.
	getMiniBodies() {
		for (const body of this.miniBodies) {
			if (!body.isConnected) {
				this.miniBodies.delete(body);
			}
		}
		return Array.from(this.miniBodies);
	},

	// Which surface a mini body lives on. Section bodies sit inside shadow DOM,
	// so plain closest() can't see #zotero-context-pane — walk shadow hosts.
	getSurfaceOfBody(body) {
		let node = body;
		while (node) {
			if (node.id === "zotero-context-pane") {
				return "reader";
			}
			node = node.parentElement || node.getRootNode?.()?.host || null;
		}
		return "library";
	},

	renderNotebookSection({ doc, body }) {
		this.setNotebookSectionLabel(body);
		body.textContent = "";
		const win = doc.defaultView;

		const header = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
		header.className = "zys-notebook-mini-header";

		const claimArea = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
		claimArea.className = "zys-notebook-mini-claim";
		header.appendChild(claimArea);

		const expand = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
		expand.className = "zys-notebook-mini-expand";
		expand.textContent = "⤢";
		expand.title = "Expand to full pane";
		expand.hidden = !this.getPanelPrefs().full;
		expand.addEventListener("click", () => {
			this.activate(win, this.getSurfaceOfBody(body));
		});
		header.appendChild(expand);

		const slot = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
		slot.className = "zys-notebook-mini-slot";

		body.appendChild(header);
		body.appendChild(slot);
		body._zysNotebookSlot = slot;
		body._zysNotebookClaim = claimArea;
		this.miniBodies.add(body);

		this.claimMiniBrowser(win, body);
	},

	// Render a placeholder in a mini body's slot, with an optional
	// "Show NotebookLM here" button that claims the browser into it.
	setMiniPlaceholder(win, body, message, showClaimButton) {
		const slot = body._zysNotebookSlot;
		const claimArea = body._zysNotebookClaim;
		if (!slot) {
			return;
		}
		// If the shared browser currently lives in this slot, don't disturb it.
		const state = this.windows.get(win);
		if (state?.browser && state.browser.parentElement === slot) {
			slot.textContent = "";
			slot.appendChild(state.browser);
		}
		else {
			slot.textContent = "";
			const doc = win.document;
			const ph = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
			ph.className = "zys-notebook-mini-placeholder";
			ph.textContent = message;
			slot.appendChild(ph);
		}
		if (claimArea) {
			claimArea.textContent = "";
			if (showClaimButton) {
				const doc = win.document;
				const btn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
				btn.className = "zys-notebook-mini-showhere";
				btn.textContent = "Show NotebookLM here";
				btn.addEventListener("click", () => this.claimMiniBrowser(win, body));
				claimArea.appendChild(btn);
			}
		}
	},

	// Move the shared browser into this mini body's slot (unless a full pane is
	// active, in which case show a placeholder). Every OTHER mini body gets a
	// placeholder with a "Show NotebookLM here" claim button.
	claimMiniBrowser(win, body) {
		const state = this.windows.get(win);
		if (!state) {
			return;
		}
		if (!body.isConnected) {
			return;
		}
		const slot = body._zysNotebookSlot;
		if (!slot) {
			return;
		}

		// A full pane owns the browser — mini slots just show a note.
		if (state.activeSurface) {
			this.setMiniPlaceholder(win, body, "NotebookLM is open in the full pane", false);
			for (const other of this.getMiniBodies()) {
				if (other !== body && other.ownerDocument === win.document) {
					this.setMiniPlaceholder(win, other, "NotebookLM is open in the full pane", false);
				}
			}
			return;
		}

		// Clear any placeholder left in the slot before the browser lands in it
		for (const ph of slot.querySelectorAll(".zys-notebook-mini-placeholder")) {
			ph.remove();
		}
		this.moveBrowserTo(win, state, slot);
		state.lastMiniBody = body;

		// This body now hosts the browser; make sure the placeholder is cleared.
		if (body._zysNotebookClaim) {
			body._zysNotebookClaim.textContent = "";
		}

		for (const other of this.getMiniBodies()) {
			if (other !== body && other.ownerDocument === win.document) {
				this.setMiniPlaceholder(win, other, "NotebookLM is shown in another item pane", true);
			}
		}
	},

	// Put every mini body into a placeholder state (used when a full pane opens).
	updateMiniPlaceholders(win, message) {
		for (const body of this.getMiniBodies()) {
			if (body.ownerDocument === win.document) {
				this.setMiniPlaceholder(win, body, message, false);
			}
		}
	},

	registerActor() {
		try {
			ChromeUtils.registerWindowActor(this.ACTOR_NAME, {
				child: {
					esModuleURI:
						"chrome://zys-notebook/content/actors/notebookChild.mjs",
				},
				messageManagerGroups: ["zysNotebook"],
			});
			Zotero.debug("NotebookLM Pane: actor registered");
		}
		catch (e) {
			// Already registered from a previous load
			Zotero.debug(`NotebookLM Pane: actor registration: ${e.message}`);
		}
	},

	unregisterActor() {
		try {
			ChromeUtils.unregisterWindowActor(this.ACTOR_NAME);
		}
		catch (_) {}
	},

	patchWindow(win) {
		if (this.windows.has(win)) {
			return;
		}

		const state = {
			style: this.injectStyle(win),
			retryTimer: null,
			miniToggleTimer: null,
			miniToggleListeners: [],
			activeSurface: null, // "library" | "reader" | null
			browser: null, // single shared browser, moved between surfaces
			fullPanelRegistered: false,
			surfaces: {
				library: { pane: null, button: null, divider: null, sidenav: null, guard: null },
				reader: { pane: null, button: null, divider: null, sidenav: null, guard: null },
			},
		};
		this.windows.set(win, state);
		this.installMiniToggle(win);

		const tryInstall = () => {
			state.retryTimer = null;
			const doc = win.document;
			const itemPane = doc.getElementById("zotero-item-pane");
			const librarySidenav = doc.getElementById("zotero-view-item-sidenav");
			const deck = doc.getElementById("zotero-item-pane-content");
			const readerSidenav = doc.getElementById("zotero-context-pane-sidenav");
			if (!itemPane || !librarySidenav || !deck) {
				state.retryTimer = win.setTimeout(tryInstall, 250);
				return;
			}
			try {
				this.applyFullPanelPref(win, {
					librarySidenav,
					readerSidenav,
				});
				Zotero.debug("NotebookLM Pane: window patched");
			}
			catch (e) {
				Zotero.debug(`NotebookLM Pane: install failed: ${e}`);
			}
		};
		tryInstall();
	},

	applyFullPanelPref(win, surfaces = {}) {
		const state = this.windows.get(win);
		if (!state) {
			return;
		}
		if (this.getPanelPrefs().full) {
			this.installFullPanelControls(win, state, surfaces);
		}
		else {
			this.teardownFullPanelControls(win, state);
		}
	},

	installFullPanelControls(win, state, surfaces = {}) {
		const doc = win.document;
		const librarySidenav = surfaces.librarySidenav
			|| doc.getElementById("zotero-view-item-sidenav");
		const readerSidenav = surfaces.readerSidenav
			|| doc.getElementById("zotero-context-pane-sidenav");
		if (!librarySidenav) {
			return;
		}
		this.installSidenavButton(win, state, librarySidenav, "library");
		if (readerSidenav) {
			this.installSidenavButton(win, state, readerSidenav, "reader");
		}
		if (!state.fullPanelRegistered) {
			// If another pane takeover (e.g. Praetor full mode) displaces us,
			// just clear our state — the manager already handled visibility.
			ensureZysTakeover().register(win, "notebook", {
				onEvicted: () => {
					state.activeSurface = null;
					this.updateButtonState(win);
					this.returnBrowserToMini(win);
				},
			});
			state.fullPanelRegistered = true;
		}
		this.installContextMenu(win, state);
		this.installDragAugment(win, state);
	},

	teardownFullPanelControls(win, state) {
		if (state.activeSurface) {
			this.deactivate(win);
		}
		if (state.fullPanelRegistered) {
			try {
				ensureZysTakeover().unregister(win, "notebook");
			}
			catch (_) {}
			state.fullPanelRegistered = false;
		}
		for (const name of Object.keys(state.surfaces)) {
			const surf = state.surfaces[name];
			if (surf.sidenav && surf.guard) {
				surf.sidenav.removeEventListener("click", surf.guard, true);
			}
			surf.button?.parentElement?.remove();
			surf.divider?.remove();
			surf.pane?.remove();
			surf.button = null;
			surf.divider = null;
			surf.pane = null;
			surf.sidenav = null;
			surf.guard = null;
		}
		if (state.itemMenu && state.onPopupShowing) {
			state.itemMenu.removeEventListener("popupshowing", state.onPopupShowing);
			state.itemMenu = null;
			state.onPopupShowing = null;
		}
		if (state.dragTree && state.dragHandler) {
			state.dragTree.removeEventListener("dragstart", state.dragHandler, false);
			state.dragTree = null;
			state.dragHandler = null;
		}
		state.sendMenuItem?.remove();
		state.sendMenuItem = null;
		if (state.browser && !state.browser.isConnected) {
			state.browser = null;
		}
	},

	// Per-surface DOM: where the button lives, what to hide, where the pane goes,
	// and how to force the surface open.
	getSurface(win, name) {
		const doc = win.document;
		if (name === "library") {
			const container = doc.getElementById("zotero-item-pane");
			return {
				name,
				container,
				hideEl: doc.getElementById("zotero-item-pane-content"),
				sidenav: doc.getElementById("zotero-view-item-sidenav"),
				expand: () => {
					container?.removeAttribute("collapsed");
					const splitter = container?.previousElementSibling;
					if (splitter?.localName === "splitter") {
						splitter.setAttribute("state", "open");
					}
				},
			};
		}
		const container = doc.getElementById("zotero-context-pane");
		return {
			name,
			container,
			hideEl: container?.querySelector(":scope > vbox"),
			sidenav: doc.getElementById("zotero-context-pane-sidenav"),
			expand: () => {
				try {
					win.ZoteroContextPane.collapsed = false;
				}
				catch (e) {
					Zotero.debug(`NotebookLM Pane: context pane expand failed: ${e}`);
				}
			},
		};
	},

	installContextMenu(win, state) {
		const doc = win.document;
		const itemMenu = doc.getElementById("zotero-itemmenu");
		if (!itemMenu || doc.getElementById("zys-notebook-send")) {
			return;
		}
		const menuitem = doc.createXULElement("menuitem");
		menuitem.id = "zys-notebook-send";
		menuitem.setAttribute("label", "Send PDF to NotebookLM");
		menuitem.addEventListener("command", () => {
			this.sendSelectedToNotebook(win).catch((e) => {
				Zotero.debug(`NotebookLM Pane: send failed: ${e}`);
			});
		});
		const onPopupShowing = () => {
			this.collectSelectedPDFs(win).then((files) => {
				menuitem.hidden = !files.length;
				menuitem.setAttribute(
					"label",
					files.length > 1
						? `Send ${files.length} PDFs to NotebookLM`
						: "Send PDF to NotebookLM"
				);
			});
		};
		itemMenu.addEventListener("popupshowing", onPopupShowing);
		itemMenu.appendChild(menuitem);
		state.sendMenuItem = menuitem;
		state.itemMenu = itemMenu;
		state.onPopupShowing = onPopupShowing;
	},

	// Zotero only puts a draggable file on the drag for items that ARE attachments,
	// so dragging a parent book carries no file and NotebookLM's dropzone sees
	// nothing. We add the parent's file attachments as application/x-moz-file, in a
	// bubbling dragstart listener that runs after Zotero's own. Internal Zotero
	// drops are unaffected: getDataFromDataTransfer prefers zotero/item over files.
	installDragAugment(win, state) {
		const tree = win.document.getElementById("zotero-items-tree");
		if (!tree || state.dragTree) {
			return;
		}
		const handler = (event) => {
			try {
				this.addParentFilesToDrag(win, event);
			}
			catch (e) {
				Zotero.debug(`NotebookLM Pane: drag augment failed: ${e}`);
			}
		};
		tree.addEventListener("dragstart", handler, false);
		state.dragTree = tree;
		state.dragHandler = handler;
	},

	addParentFilesToDrag(win, event) {
		const dt = event.dataTransfer;
		if (!dt || !Array.from(dt.types).includes("zotero/item")) {
			return;
		}
		const items = win.ZoteroPane?.getSelectedItems?.() || [];

		// Paths Zotero already placed on the drag (any selected attachments)
		const seen = new Set();
		for (const item of items) {
			if (item.isAttachment?.()) {
				const path = item.getFilePath?.();
				if (path) {
					seen.add(path);
				}
			}
		}

		let index = dt.mozItemCount;
		for (const item of items) {
			if (!item.isRegularItem?.()) {
				continue;
			}
			for (const id of item.getAttachments?.() || []) {
				const att = Zotero.Items.get(id);
				const path = att?.isAttachment?.() ? att.getFilePath?.() : "";
				if (!path || seen.has(path)) {
					continue;
				}
				const file = Zotero.File.pathToFile(path);
				if (!file?.exists()) {
					continue;
				}
				dt.mozSetDataAt("application/x-moz-file", file, index++);
				seen.add(path);
			}
		}
	},

	async collectSelectedPDFs(win) {
		const files = [];
		try {
			const items = win.ZoteroPane?.getSelectedItems?.() || [];
			for (const item of items) {
				let attachment = null;
				if (item.isAttachment?.()) {
					attachment = item;
				}
				else if (item.isRegularItem?.()) {
					for (const id of item.getAttachments?.() || []) {
						const candidate = Zotero.Items.get(id);
						if (candidate?.attachmentContentType === "application/pdf") {
							attachment = candidate;
							break;
						}
					}
				}
				if (!attachment) {
					continue;
				}
				if (attachment.attachmentContentType !== "application/pdf") {
					continue;
				}
				const path = await attachment.getFilePathAsync();
				if (path) {
					files.push({
						path,
						title: item.getDisplayTitle?.() || attachment.attachmentFilename,
					});
				}
			}
		}
		catch (e) {
			Zotero.debug(`NotebookLM Pane: collectSelectedPDFs: ${e}`);
		}
		return files;
	},

	getActor(state) {
		try {
			return state.browser?.browsingContext?.currentWindowGlobal?.getActor(
				this.ACTOR_NAME
			);
		}
		catch (e) {
			Zotero.debug(`NotebookLM Pane: getActor failed: ${e}`);
			return null;
		}
	},

	// NotebookLM (a Chromium-oriented app) won't accept a file that Zotero injects
	// programmatically — Gecko blocks synthetic file-drops and script-triggered
	// file pickers. So we do the reliable thing: open the panel, bring NotebookLM
	// to its Add sources dialog, and put the PDF's path on the clipboard, so the
	// user finishes with: Upload files → Cmd+Shift+G → Cmd+V → Enter.
	async sendSelectedToNotebook(win) {
		const state = this.windows.get(win);
		if (!state) {
			return;
		}
		const files = await this.collectSelectedPDFs(win);
		if (!files.length) {
			this.showProgress(win, "NotebookLM", ["No PDF attachment on the selected item(s)."]);
			return;
		}

		if (!state.activeSurface) {
			this.activate(win, "library");
		}
		if (!state.browser?.currentURI?.spec?.includes("google.com")) {
			await Zotero.Promise.delay(3000);
		}

		// Put the first PDF's path on the clipboard for the native picker's Go-to
		const first = files[0];
		try {
			Zotero.Utilities.Internal.copyTextToClipboard(first.path);
		}
		catch (e) {
			Zotero.debug(`NotebookLM Pane: clipboard copy failed: ${e}`);
		}

		const actor = this.getActor(state);
		if (actor) {
			try {
				await actor.sendQuery("openAddSources");
			}
			catch (e) {
				Zotero.debug(`NotebookLM Pane: openAddSources failed: ${e}`);
			}
		}

		const hint
			= files.length > 1
				? `${files.length} PDFs — path of “${first.title}” copied. In the panel: Upload files → ⌘⇧G → ⌘V → Enter (repeat per file).`
				: `Path copied. In the panel: Upload files → ⌘⇧G → ⌘V → Enter.`;
		this.showProgress(win, "Ready to upload to NotebookLM", [
			first.title,
			hint,
		]);
	},

	showProgress(win, headline, lines) {
		try {
			const pw = new Zotero.ProgressWindow({ window: win });
			pw.changeHeadline(headline);
			for (const line of lines) {
				pw.addDescription(line);
			}
			pw.show();
			pw.startCloseTimer(6000);
		}
		catch (e) {
			Zotero.debug(`NotebookLM Pane: progress window failed: ${e}`);
		}
	},

	unpatchWindow(win) {
		const state = this.windows.get(win);
		if (!state) {
			return;
		}
		if (state.retryTimer) {
			win.clearTimeout(state.retryTimer);
		}
		if (state.miniToggleTimer) {
			win.clearTimeout(state.miniToggleTimer);
		}
		for (const { sidenav, listener } of state.miniToggleListeners) {
			try {
				sidenav.removeEventListener("click", listener, true);
				sidenav.classList.remove("zys-notebook-mini-off");
			}
			catch (_) {}
		}
		state.miniToggleListeners = [];
		try {
			if (state.browser?.currentURI?.spec?.startsWith("https://")) {
				this.savePref(this.PREF_LAST_URL, state.browser.currentURI.spec);
			}
		}
		catch (_) {}
		// Hand our takeover back (restores the standard content if we were
		// active) and remove our UI
		this.teardownFullPanelControls(win, state);
		state.style?.remove();
		this.windows.delete(win);
	},

	injectStyle(win) {
		const doc = win.document;
		let style = doc.getElementById("zys-notebook-style");
		if (style) {
			return style;
		}
		style = doc.createElementNS("http://www.w3.org/1999/xhtml", "link");
		style.id = "zys-notebook-style";
		style.rel = "stylesheet";
		style.href = "chrome://zys-notebook/content/styles/notebook.css";
		doc.documentElement.appendChild(style);
		return style;
	},

	installSidenavButton(win, state, sidenav, surfaceName) {
		const doc = win.document;
		const surf = state.surfaces[surfaceName];
		const buttonID = `${this.BUTTON_ID}-${surfaceName}`;
		if (doc.getElementById(buttonID)) {
			return;
		}

		const divider = doc.createElement("div");
		divider.className = "divider";

		const wrapper = doc.createElement("div");
		wrapper.className = "pin-wrapper";

		const button = doc.createXULElement("div");
		button.id = buttonID;
		button.classList.add("btn");
		button.setAttribute("custom", "true");
		button.setAttribute("tabindex", "0");
		button.setAttribute("role", "tab");
		button.setAttribute("tooltiptext", "NotebookLM");
		const icon = "chrome://zys-notebook/content/icons/notebook-full.svg";
		button.style = `--custom-sidenav-icon-light: url('${icon}'); --custom-sidenav-icon-dark: url('${icon}');`;
		button.addEventListener("click", () => this.toggle(win, surfaceName));
		button.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				this.toggle(win, surfaceName);
			}
		});

		// Turn our panel off if the user clicks any other sidenav section, so the
		// standard pane comes back. Capture phase runs before Zotero's handlers.
		const guard = (event) => {
			if (state.activeSurface !== surfaceName) {
				return;
			}
			const btn = event.target.closest?.(".btn");
			if (!btn || btn === button) {
				return;
			}
			this.deactivate(win);
		};
		sidenav.addEventListener("click", guard, true);

		wrapper.appendChild(button);
		sidenav.appendChild(divider);
		sidenav.appendChild(wrapper);
		surf.button = button;
		surf.divider = divider;
		surf.sidenav = sidenav;
		surf.guard = guard;
	},

	updateButtonState(win) {
		const state = this.windows.get(win);
		if (!state) {
			return;
		}
		for (const name of Object.keys(state.surfaces)) {
			const surf = state.surfaces[name];
			surf.button?.classList.toggle(
				"zys-notebook-active",
				state.activeSurface === name
			);
		}
	},

	toggle(win, surfaceName = "library") {
		if (!this.getPanelPrefs().full) {
			return;
		}
		const state = this.windows.get(win);
		if (!state) {
			return;
		}
		if (state.activeSurface === surfaceName) {
			this.deactivate(win);
		}
		else {
			this.activate(win, surfaceName);
		}
	},

	// Show NotebookLM by hiding the surface's own content (rather than switching
	// a deck child, which Zotero resets whenever a book is selected). This makes
	// the toggle sticky: item selection no longer disturbs it. Only one surface
	// shows the panel at a time; the shared browser moves between them.
	activate(win, surfaceName = "library") {
		if (!this.getPanelPrefs().full) {
			return;
		}
		const state = this.windows.get(win);
		if (!state) {
			return;
		}
		if (state.activeSurface && state.activeSurface !== surfaceName) {
			this.deactivate(win);
		}
		const surface = this.getSurface(win, surfaceName);
		if (!surface.container || !surface.hideEl) {
			Zotero.debug(`NotebookLM Pane: surface ${surfaceName} not available`);
			return;
		}

		this.ensurePane(win, state, surface);
		this.moveBrowserTo(win, state, state.surfaces[surfaceName].pane);

		const shown = ensureZysTakeover().show(
			win,
			surfaceName,
			"notebook",
			state.surfaces[surfaceName].pane
		);
		if (!shown) {
			Zotero.debug(`NotebookLM Pane: takeover show failed for ${surfaceName}`);
			return;
		}
		state.activeSurface = surfaceName;
		this.updateButtonState(win);
		// The browser now lives in the full pane; all mini slots show a note.
		this.updateMiniPlaceholders(win, "NotebookLM is open in the full pane");
	},

	deactivate(win) {
		const state = this.windows.get(win);
		if (!state?.activeSurface) {
			return;
		}
		ensureZysTakeover().hide(win, "notebook");
		state.activeSurface = null;
		this.updateButtonState(win);
		this.returnBrowserToMini(win);
	},

	// After the full pane closes, hand the shared browser back to the most
	// recently claimed CONNECTED mini body if one exists; otherwise leave it in
	// the (now hidden) full pane. Refresh every mini body's placeholder.
	returnBrowserToMini(win) {
		const state = this.windows.get(win);
		if (!state) {
			return;
		}
		let target = state.lastMiniBody;
		if (!target || !target.isConnected || target.ownerDocument !== win.document
			|| !target._zysNotebookSlot) {
			target = this.getMiniBodies().find(
				b => b.ownerDocument === win.document && b._zysNotebookSlot
			) || null;
		}
		if (target) {
			this.claimMiniBrowser(win, target);
		}
		else {
			this.updateMiniPlaceholders(win, "Click the sidebar icon to open NotebookLM");
		}
	},

	ensurePane(win, state, surface) {
		const surf = state.surfaces[surface.name];
		if (surf.pane && surf.pane.parentElement === surface.container) {
			return;
		}
		const doc = win.document;

		const pane = doc.createXULElement("vbox");
		pane.id = `${this.PANE_ID}-${surface.name}`;
		pane.className = "zys-notebook-pane zys-takeover-pane";
		pane.setAttribute("flex", "1");
		pane.hidden = true;

		const toolbar = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
		toolbar.className = "zys-notebook-toolbar";
		const addButton = (label, tooltip, handler) => {
			const btn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
			btn.className = "zys-notebook-toolbar-btn";
			btn.textContent = label;
			btn.title = tooltip;
			btn.addEventListener("click", handler);
			toolbar.appendChild(btn);
			return btn;
		};
		addButton("‹", "Back", () => {
			try {
				state.browser?.goBack();
			}
			catch (_) {}
		});
		addButton("›", "Forward", () => {
			try {
				state.browser?.goForward();
			}
			catch (_) {}
		});
		addButton("⟳", "Reload", () => {
			try {
				state.browser?.reload();
			}
			catch (_) {}
		});
		addButton("⌂", "NotebookLM home", () => {
			this.loadURL(state, this.HOME_URL);
		});
		addButton("⧉", "Open in separate window", () => {
			const url = state.browser?.currentURI?.spec || this.HOME_URL;
			try {
				Zotero.openInViewer(url);
			}
			catch (e) {
				Zotero.debug(`NotebookLM Pane: openInViewer failed: ${e}`);
			}
		});

		pane.appendChild(toolbar);
		// Insert as a sibling of the deck, before the sidenav, so it fills the
		// pane content area when the surface's own content is hidden.
		surface.container.insertBefore(pane, surface.sidenav || null);
		surf.pane = pane;
	},

	createBrowserElement(doc) {
		const browser = doc.createXULElement("browser");
		browser.className = "zys-notebook-browser";
		browser.setAttribute("type", "content");
		browser.setAttribute("remote", "true");
		browser.setAttribute("maychangeremoteness", "true");
		browser.setAttribute("disableglobalhistory", "true");
		browser.setAttribute("messagemanagergroup", "zysNotebook");
		browser.setAttribute("flex", "1");
		return browser;
	},

	applyUserAgent(browser) {
		// Present a stock Firefox UA so Google sign-in doesn't flag the embedded context
		try {
			const major = Services.appinfo.platformVersion.split(".")[0];
			browser.browsingContext.customUserAgent
				= `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:${major}.0) Gecko/20100101 Firefox/${major}.0`;
		}
		catch (e) {
			Zotero.debug(`NotebookLM Pane: could not set custom UA: ${e}`);
		}
	},

	// Ensure the single shared browser lives inside `pane`. When it's in the
	// other surface's pane, move the loaded page across via a frameloader swap
	// (no reload); if the swap fails, fall back to reloading the current URL.
	moveBrowserTo(win, state, pane) {
		if (state.browser && !state.browser.isConnected) {
			state.browser = null;
		}
		if (state.browser && state.browser.parentElement === pane) {
			return;
		}
		const doc = win.document;
		const newBrowser = this.createBrowserElement(doc);
		pane.appendChild(newBrowser);

		if (!state.browser) {
			state.browser = newBrowser;
			this.applyUserAgent(newBrowser);
			this.loadURL(state, this.getPref(this.PREF_LAST_URL, this.HOME_URL));
			return;
		}

		const oldBrowser = state.browser;
		let swapped = false;
		let currentURL = null;
		try {
			currentURL = oldBrowser.currentURI?.spec || null;
		}
		catch (_) {}
		try {
			oldBrowser.swapFrameLoaders(newBrowser);
			swapped = true;
		}
		catch (e) {
			Zotero.debug(`NotebookLM Pane: frameloader swap failed, reloading: ${e}`);
		}
		oldBrowser.remove();
		state.browser = newBrowser;
		if (!swapped) {
			this.applyUserAgent(newBrowser);
			this.loadURL(
				state,
				currentURL && currentURL.startsWith("https://")
					? currentURL
					: this.getPref(this.PREF_LAST_URL, this.HOME_URL)
			);
		}
	},

	loadURL(state, url) {
		if (!state.browser) {
			return;
		}
		try {
			state.browser.loadURI(Services.io.newURI(url), {
				triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
			});
		}
		catch (e) {
			Zotero.debug(`NotebookLM Pane: loadURI failed for ${url}: ${e}`);
		}
	},

	getPref(key, defaultValue) {
		try {
			const value = Zotero.Prefs.get(key);
			return value === undefined || value === null ? defaultValue : value;
		}
		catch (_) {
			return defaultValue;
		}
	},

	savePref(key, value) {
		try {
			Zotero.Prefs.set(key, value);
		}
		catch (_) {}
	},
};

// Shared takeover manager for add-ons that swap the right pane.
// The same block ships in each add-on; the first to load provides the
// singleton, so all show/hide decisions flow through ONE code path and
// exactly one pane (or the standard content) is visible per surface.
function ensureZysTakeover() {
	const VERSION = 2;
	if (Zotero.ZysTakeover && Zotero.ZysTakeover.VERSION >= VERSION) {
		return Zotero.ZysTakeover;
	}
	Zotero.ZysTakeover = {
		VERSION,
		_windows: new WeakMap(),

		_state(win) {
			let s = this._windows.get(win);
			if (!s) {
				s = { owners: new Map(), active: null, observers: new Map() };
				this._windows.set(win, s);
			}
			return s;
		},

		// If Zotero itself collapses a surface (user hits the collapse toggle or
		// drags the splitter shut), treat that as an eviction: clear the takeover
		// so the standard content is back when the surface reopens.
		_observeCollapse(win, surfaceName, container) {
			const s = this._state(win);
			if (s.observers.has(surfaceName) || !container) {
				return;
			}
			const observer = new win.MutationObserver(() => {
				const collapsed = container.getAttribute("collapsed") === "true";
				const a = s.active;
				if (collapsed && a && a.surfaceName === surfaceName) {
					const ownerId = a.ownerId;
					this.hide(win, ownerId);
					try {
						s.owners.get(ownerId)?.onEvicted?.(win, surfaceName);
					}
					catch (_) {}
				}
			});
			observer.observe(container, {
				attributes: true,
				attributeFilter: ["collapsed"],
			});
			s.observers.set(surfaceName, observer);
		},

		getSurface(win, name) {
			const doc = win.document;
			if (name === "library") {
				const container = doc.getElementById("zotero-item-pane");
				return {
					name,
					container,
					hideEl: doc.getElementById("zotero-item-pane-content"),
					sidenav: doc.getElementById("zotero-view-item-sidenav"),
					expand: () => {
						container?.removeAttribute("collapsed");
						const splitter = container?.previousElementSibling;
						if (splitter?.localName === "splitter") {
							splitter.setAttribute("state", "open");
						}
					},
				};
			}
			const container = doc.getElementById("zotero-context-pane");
			return {
				name,
				container,
				hideEl: container?.querySelector(":scope > vbox"),
				sidenav: doc.getElementById("zotero-context-pane-sidenav"),
				expand: () => {
					try {
						win.ZoteroContextPane.collapsed = false;
					}
					catch (_) {}
				},
			};
		},

		register(win, ownerId, callbacks) {
			this._state(win).owners.set(ownerId, callbacks || {});
		},

		unregister(win, ownerId) {
			const s = this._state(win);
			if (s.active?.ownerId === ownerId) {
				this.hide(win, ownerId);
			}
			s.owners.delete(ownerId);
		},

		// Show `pane` on `surfaceName`, hiding the standard content and every
		// other takeover pane. Returns true on success.
		show(win, surfaceName, ownerId, pane) {
			const s = this._state(win);
			const surface = this.getSurface(win, surfaceName);
			if (!surface.container || !surface.hideEl || !pane) {
				return false;
			}
			const prev = s.active;
			surface.expand();
			surface.hideEl.hidden = true;
			for (const el of surface.container.querySelectorAll(
				":scope > .zys-takeover-pane"
			)) {
				el.hidden = el !== pane;
			}
			pane.hidden = false;
			// If the previous takeover was on a different surface, restore it
			if (prev && prev.surfaceName !== surfaceName) {
				try {
					const prevSurface = this.getSurface(win, prev.surfaceName);
					if (prev.pane) {
						prev.pane.hidden = true;
					}
					if (prevSurface.hideEl) {
						prevSurface.hideEl.hidden = false;
					}
				}
				catch (_) {}
			}
			s.active = { ownerId, surfaceName, pane };
			this._observeCollapse(win, surfaceName, surface.container);
			if (prev && prev.ownerId !== ownerId) {
				try {
					s.owners.get(prev.ownerId)?.onEvicted?.(win, prev.surfaceName);
				}
				catch (_) {}
			}
			return true;
		},

		// Hide `ownerId`'s pane and restore the standard content. No-op if that
		// owner is not the active one (it may have been evicted already).
		hide(win, ownerId) {
			const s = this._state(win);
			if (s.active?.ownerId !== ownerId) {
				return false;
			}
			const { surfaceName, pane } = s.active;
			try {
				const surface = this.getSurface(win, surfaceName);
				if (pane) {
					pane.hidden = true;
				}
				if (surface.hideEl) {
					surface.hideEl.hidden = false;
				}
			}
			catch (_) {}
			s.active = null;
			return true;
		},

		active(win) {
			const a = this._state(win).active;
			return a ? { ownerId: a.ownerId, surfaceName: a.surfaceName } : null;
		},
	};
	return Zotero.ZysTakeover;
}

Zotero.ZysNotebook = ZysNotebook;
