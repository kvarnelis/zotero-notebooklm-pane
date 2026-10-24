/* global JSWindowActorChild:false */

const ADD_SOURCE_PATTERNS = [/add source/i, /add sources/i, /upload source/i];

export class ZysNotebookChild extends JSWindowActorChild {
	async receiveMessage(message) {
		switch (message.name) {
			case "openAddSources":
				return this.openAddSources();
		}
		return null;
	}

	labelOf(el) {
		return `${el.getAttribute("aria-label") || ""} ${
			(el.textContent || "").trim()
		}`.trim();
	}

	clickFirstMatching(patterns) {
		const candidates = Array.from(
			this.document.querySelectorAll(
				"button, [role='button'], [role='tab'], a"
			)
		);
		for (const pattern of patterns) {
			for (const el of candidates) {
				if (pattern.test(this.labelOf(el))) {
					el.click();
					return this.labelOf(el).slice(0, 60);
				}
			}
		}
		return null;
	}

	uploadButtonPresent() {
		return Array.from(
			this.document.querySelectorAll("button, [role='button']")
		).some(el => /upload files/i.test(this.labelOf(el)));
	}

	// Bring the notebook to its "Add sources" dialog so the user is one click
	// (Upload files) away from importing. Idempotent if already open.
	async openAddSources() {
		const win = this.contentWindow;
		const steps = [];
		if (this.uploadButtonPresent()) {
			return { ok: true, alreadyOpen: true, steps };
		}
		const tab = this.clickFirstMatching([/^sources$/i, /\bsources\b/i]);
		if (tab) {
			steps.push(`tab:${tab}`);
			await new Promise(r => win.setTimeout(r, 500));
		}
		const add = this.clickFirstMatching(ADD_SOURCE_PATTERNS);
		if (add) {
			steps.push(`add:${add}`);
			await new Promise(r => win.setTimeout(r, 1000));
		}
		return { ok: this.uploadButtonPresent(), steps };
	}
}
