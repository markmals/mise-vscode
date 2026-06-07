import { type ChildProcess, spawn } from "node:child_process";
import * as vscode from "vscode";
import { getMiseEnv } from "./configuration";
import type { MiseService } from "./miseService";
import { isWindows } from "./utils/fileUtils";
import { logger } from "./utils/logger";

type RunningTask = {
	name: string;
	child: ChildProcess;
	output: vscode.OutputChannel;
	killedByUser: boolean;
	/** Resolves once the process has fully exited. */
	closed: Promise<void>;
};

/** How long to wait after SIGTERM before escalating to SIGKILL. */
const KILL_GRACE_MS = 4_000;

/**
 * Runs mise tasks as background processes instead of in terminals.
 *
 * Output is streamed to a per-task {@link vscode.OutputChannel} that stays
 * hidden unless the task fails (or the user asks to see it). Long-running tasks
 * (e.g. dev servers) can be stopped; we spawn detached and signal the whole
 * process group so child processes don't get orphaned.
 */
export class BackgroundTaskRunner {
	private readonly runningTasks = new Map<string, RunningTask>();
	private readonly outputChannels = new Map<string, vscode.OutputChannel>();
	private readonly statusBarItem: vscode.StatusBarItem;

	private readonly _onDidChangeRunningTasks = new vscode.EventEmitter<void>();
	readonly onDidChangeRunningTasks = this._onDidChangeRunningTasks.event;

	constructor(private readonly miseService: MiseService) {
		this.statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			100,
		);
		this.statusBarItem.command = "mise.stopTask";
	}

	isRunning(taskName: string): boolean {
		return this.runningTasks.has(taskName);
	}

	getRunningTaskNames(): string[] {
		return [...this.runningTasks.keys()];
	}

	private getOutputChannel(taskName: string): vscode.OutputChannel {
		let channel = this.outputChannels.get(taskName);
		if (!channel) {
			channel = vscode.window.createOutputChannel(`Mise Task: ${taskName}`);
			this.outputChannels.set(taskName, channel);
		}
		return channel;
	}

	showOutput(taskName: string) {
		this.outputChannels.get(taskName)?.show();
	}

	async run(taskName: string, args: string[] = []): Promise<void> {
		const binPath = this.miseService.getMiseBinaryPath();
		if (!binPath) {
			logger.error("Cannot run task: mise binary path is not configured");
			return;
		}

		// Re-running an active task restarts it (handy for dev servers).
		if (this.isRunning(taskName)) {
			await this.stop(taskName);
		}

		const miseEnv = getMiseEnv();
		const runArgs = [
			...(miseEnv ? ["--env", miseEnv] : []),
			"run",
			taskName,
			...args,
		];

		const output = this.getOutputChannel(taskName);
		output.clear();
		output.appendLine(`$ mise ${runArgs.join(" ")}`);
		output.appendLine("");

		const child = spawn(binPath, runArgs, {
			cwd: this.miseService.getCurrentWorkspaceFolderPath(),
			env: await this.miseService.getMiseRunEnv(),
			// New process group so we can signal the whole tree on stop.
			detached: !isWindows,
			windowsHide: true,
		});

		if (child.pid === undefined) {
			output.appendLine("Failed to start mise process.");
			logger.error(`Failed to start task '${taskName}'`);
			return;
		}

		let resolveClosed: () => void = () => {};
		const closed = new Promise<void>((resolve) => {
			resolveClosed = resolve;
		});

		const runningTask: RunningTask = {
			name: taskName,
			child,
			output,
			killedByUser: false,
			closed,
		};
		this.runningTasks.set(taskName, runningTask);
		this.updateStatusBar();
		this._onDidChangeRunningTasks.fire();

		child.stdout?.on("data", (data: Buffer) => output.append(data.toString()));
		child.stderr?.on("data", (data: Buffer) => output.append(data.toString()));

		child.on("error", (error) => {
			output.appendLine(`\nFailed to run task: ${error.message}`);
			logger.error(`Error running task '${taskName}'`, error);
		});

		child.on("close", (code, signal) => {
			this.runningTasks.delete(taskName);
			this.updateStatusBar();
			this._onDidChangeRunningTasks.fire();

			if (runningTask.killedByUser) {
				output.appendLine(`\nTask '${taskName}' stopped.`);
			} else if (code === 0) {
				output.appendLine(`\nTask '${taskName}' completed.`);
				vscode.window.setStatusBarMessage(`$(check) mise: ${taskName}`, 3_000);
			} else {
				const detail = signal ? `signal ${signal}` : `exit code ${code}`;
				output.appendLine(`\nTask '${taskName}' failed (${detail}).`);
				void vscode.window
					.showErrorMessage(
						`Mise task '${taskName}' failed (${detail}).`,
						"Show Output",
					)
					.then((selection) => {
						if (selection === "Show Output") {
							output.show();
						}
					});
			}
			resolveClosed();
		});
	}

	async stop(taskName: string): Promise<void> {
		const runningTask = this.runningTasks.get(taskName);
		if (!runningTask) {
			return;
		}
		runningTask.killedByUser = true;
		this.killProcessTree(runningTask.child, taskName);
		await runningTask.closed;
	}

	async stopAll(): Promise<void> {
		await Promise.all(
			this.getRunningTaskNames().map((name) => this.stop(name)),
		);
	}

	private killProcessTree(child: ChildProcess, taskName: string) {
		const pid = child.pid;
		if (pid === undefined) {
			return;
		}

		if (isWindows) {
			spawn("taskkill", ["/pid", String(pid), "/T", "/F"]);
			return;
		}

		// Negative pid signals the whole process group (created via `detached`).
		try {
			process.kill(-pid, "SIGTERM");
		} catch (error) {
			logger.debug(`SIGTERM for task '${taskName}' failed`, error);
		}

		setTimeout(() => {
			if (!this.runningTasks.has(taskName)) {
				return;
			}
			try {
				process.kill(-pid, "SIGKILL");
			} catch (error) {
				logger.debug(`SIGKILL for task '${taskName}' failed`, error);
			}
		}, KILL_GRACE_MS);
	}

	private updateStatusBar() {
		const names = this.getRunningTaskNames();
		if (names.length === 0) {
			this.statusBarItem.hide();
			return;
		}
		this.statusBarItem.text =
			names.length === 1
				? `$(sync~spin) mise: ${names[0]}`
				: `$(sync~spin) mise: ${names.length} tasks`;
		this.statusBarItem.tooltip =
			names.length === 1
				? `Running '${names[0]}' — click to stop`
				: `Running tasks: ${names.join(", ")} — click to stop`;
		this.statusBarItem.show();
	}

	dispose() {
		void this.stopAll();
		this.statusBarItem.dispose();
		this._onDidChangeRunningTasks.dispose();
		for (const channel of this.outputChannels.values()) {
			channel.dispose();
		}
		this.outputChannels.clear();
	}
}
