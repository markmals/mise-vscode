import * as assert from "node:assert";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

const markerPath = (name: string) =>
	path.join(os.tmpdir(), `mise-bg-${name}.txt`);

const rm = (file: string) => {
	try {
		fs.unlinkSync(file);
	} catch {
		// missing is fine
	}
};

const waitForFile = async (file: string, timeoutMs = 15_000) => {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (fs.existsSync(file)) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	return false;
};

suite("Background Tasks Test Suite", function () {
	this.timeout(40_000);

	setup(() => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(workspaceRoot, "Workspace root should be available");
		execFileSync("mise", ["trust", path.join(workspaceRoot, "mise.toml")]);

		rm(markerPath("quick"));
		rm(markerPath("started"));
		rm(markerPath("stopped"));
	});

	test("runs a task in the background without opening a terminal", async () => {
		const terminalsBefore = vscode.window.terminals.length;

		await vscode.commands.executeCommand("mise.runTask", "bg-quick");

		assert.ok(
			await waitForFile(markerPath("quick")),
			"bg-quick should have run and written its marker file",
		);
		assert.equal(
			vscode.window.terminals.length,
			terminalsBefore,
			"no new terminal should be opened for a background task",
		);
	});

	test("stops a long-running task by signalling its process tree", async () => {
		await vscode.commands.executeCommand("mise.runTask", "bg-longrunner");

		assert.ok(
			await waitForFile(markerPath("started")),
			"bg-longrunner should have started",
		);

		await vscode.commands.executeCommand("mise.stopTask", "bg-longrunner");

		assert.ok(
			await waitForFile(markerPath("stopped")),
			"stopping should deliver SIGTERM to the task's process tree",
		);
	});
});
