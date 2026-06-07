import * as assert from "node:assert";
import * as vscode from "vscode";

// Regression test: the extension must not persist a resolved absolute mise path
// into the (settings-sync'd) `mise.binPath` setting. Doing so made two machines
// with mise in different locations fight over the synced value, reloading
// forever. It should resolve `mise` from PATH and keep the path in memory.
suite("mise.binPath Test Suite", function () {
	this.timeout(30_000);

	test("does not overwrite mise.binPath on activation", async () => {
		// Force the extension to resolve mise at least once.
		await vscode.tasks.fetchTasks({ type: "mise" });

		// Give any (incorrect) write-back a chance to land.
		await new Promise((resolve) => setTimeout(resolve, 1_000));

		const binPath = vscode.workspace.getConfiguration("mise").get("binPath");
		assert.equal(
			binPath,
			"mise",
			`Expected mise.binPath to remain the default "mise", but it was overwritten to "${binPath}"`,
		);
	});
});
