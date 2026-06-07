import * as assert from "node:assert";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";

// These tests run against the `monorepo-workspace` fixture, which opts into
// mise's monorepo mode (`experimental_monorepo_root = true`). The test
// environment sets `MISE_EXPERIMENTAL=0` (see .vscode-test.js) so that the
// only way the nested `//path:task` tasks can appear is if the extension itself
// re-enables the experimental flag when it detects monorepo mode.
suite("Monorepo Tasks Test Suite", function () {
	this.timeout(30_000);

	let workspaceRoot: string;

	const findMiseTasks = async (): Promise<string[]> => {
		// The extension may still be resolving the mise binary on first run, so
		// poll a few times before giving up.
		for (let attempt = 0; attempt < 10; attempt++) {
			const tasks = await vscode.tasks.fetchTasks({ type: "mise" });
			const names = tasks.map((t) => t.name);
			if (names.some((name) => name.startsWith("//"))) {
				return names;
			}
			await new Promise((resolve) => setTimeout(resolve, 1_000));
		}
		return (await vscode.tasks.fetchTasks({ type: "mise" })).map((t) => t.name);
	};

	setup(async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(root, "Workspace root should be available");
		workspaceRoot = root;

		// Trust the fixture configs so mise doesn't block on a (headless) prompt.
		const trustEnv = { ...process.env, MISE_EXPERIMENTAL: "1" };
		for (const config of [
			path.join(workspaceRoot, "mise.toml"),
			path.join(workspaceRoot, "packages", "app", "mise.toml"),
		]) {
			execFileSync("mise", ["trust", config], { env: trustEnv });
		}
	});

	test("discovers tasks from nested config roots as //path:task", async () => {
		const names = await findMiseTasks();

		assert.ok(
			names.includes("//:root-task"),
			`Expected root task //:root-task in ${JSON.stringify(names)}`,
		);
		assert.ok(
			names.includes("//packages/app:app-build"),
			`Expected nested task //packages/app:app-build in ${JSON.stringify(names)}`,
		);
	});

	test("can execute a task from a nested config root", async () => {
		const tasks = await vscode.tasks.fetchTasks({ type: "mise" });
		const nestedTask = tasks.find((t) => t.name === "//packages/app:app-build");
		assert.ok(
			nestedTask,
			"Nested task //packages/app:app-build should be found",
		);

		const execution = await vscode.tasks.executeTask(nestedTask);
		assert.ok(execution, "Task execution should start");

		await new Promise<void>((resolve, reject) => {
			const disposable = vscode.tasks.onDidEndTaskProcess((e) => {
				if (e.execution === execution) {
					disposable.dispose();
					if (e.exitCode === 0) {
						resolve();
					} else {
						reject(new Error(`Task failed with exit code ${e.exitCode}`));
					}
				}
			});
		});
	});
});
