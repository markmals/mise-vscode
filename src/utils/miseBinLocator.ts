import * as os from "node:os";
import * as path from "node:path";
import {
	getConfiguredBinPath,
	shouldAutoDetectMiseBinPath,
} from "../configuration";
import { logger } from "./logger";
import { safeExec } from "./shell";

export async function resolveMisePath(): Promise<string> {
	const configuredPath = getConfiguredBinPath();
	logger.debug(`Configured mise path: ${configuredPath}`);

	const autoDetectMiseBinPath = shouldAutoDetectMiseBinPath();
	if (configuredPath) {
		if (await isValidBinary(configuredPath)) {
			return configuredPath;
		}
		if (autoDetectMiseBinPath) {
			logger.warn(
				`Configured mise path "${configuredPath}" is invalid. Trying to resolve another path...`,
			);
		}
	}

	if (!autoDetectMiseBinPath) {
		throw new Error(
			`Auto-detection of mise binary is disabled and currently configured path ${configuredPath} is invalid`,
		);
	}

	// Prefer the bare `mise` command when it's available on PATH. This is
	// portable across machines (no hard-coded absolute path), which matters
	// because the resolved path is not persisted to the synced settings.
	if (await isValidBinary("mise")) {
		return "mise";
	}

	// Otherwise fall back to locating an absolute path (the extension host's
	// PATH doesn't always include the user's shell PATH, e.g. GUI launches).

	// check for win32 first, as `which` (see https://github.com/hverlin/mise-vscode/issues/84)
	if (process.platform === "win32") {
		const result = await safeExec("where.exe", ["mise"]);
		logger.info(`where mise: ${result.stdout}`);
		const firstEntry = result.stdout.split("\r\n")?.[0];
		const miseLocation = firstEntry?.trim();
		if (miseLocation && (await isValidBinary(miseLocation))) {
			return miseLocation;
		}
	}

	const result = await safeExec("which", ["mise"]);
	const miseLocation = result.stdout?.trim();
	logger.info(`which mise: ${miseLocation}`);
	if (miseLocation && (await isValidBinary(miseLocation))) {
		return miseLocation;
	}

	//  Check common installation locations
	const homedir = os.homedir();
	const commonPaths = [
		path.join(homedir, ".local", "bin", "mise"),
		path.join(homedir, "bin", "mise"),
	];

	if (process.platform !== "win32") {
		commonPaths.push(
			path.join("/usr", "local", "bin", "mise"),
			path.join("/opt", "homebrew", "bin", "mise"),
		);
	}

	if (process.platform === "win32") {
		commonPaths.push(path.join(homedir, "scoop", "shims", "mise.exe"));
		commonPaths.push(
			path.join("C:", "ProgramData", "chocolatey", "bin", "mise.exe"),
		);
		commonPaths.push(path.join("C:", "Program Files", "mise", "mise.exe"));
		commonPaths.push(
			path.join(
				homedir,
				"AppData",
				"Local",
				"Microsoft",
				"WinGet",
				"Links",
				"mise.exe",
			),
		);
	}

	const allPaths = [...commonPaths];

	for (const binPath of allPaths) {
		if (await isValidBinary(binPath)) {
			return binPath;
		}
	}

	throw new Error(
		"Could not find mise binary in any standard location (PATH, ~/.local/bin, ~/bin, /usr/local/bin, /opt/homebrew/bin...)",
	);
}

export async function isValidBinary(filepath: string): Promise<boolean> {
	try {
		const result = await safeExec(filepath, ["--help"]);
		return result.stdout.toLowerCase().includes("mise");
	} catch (error) {
		logger.info(
			`Path ${filepath} is not a valid mise binary: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return false;
}
