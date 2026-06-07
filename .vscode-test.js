const { defineConfig } = require("@vscode/test-cli");
const path = require("node:path");
const fixturesPath = path.join(__dirname, "src/e2e-tests/fixtures/");

const mocha = {
	require: ["tsx/cjs"],
	timeout: 60_000,
};

module.exports = defineConfig([
	{
		label: "default",
		files: "src/e2e-tests/*.e2e.ts",
		workspaceFolder: path.join(fixturesPath, "task-execution-workspace"),
		env: {
			MISE_CEILING_PATHS: fixturesPath,
		},
		installExtensions: ["tombi-toml.tombi"],
		mocha,
	},
	{
		label: "monorepo",
		files: "src/e2e-tests/monorepo/*.e2e.ts",
		workspaceFolder: path.join(fixturesPath, "monorepo-workspace"),
		env: {
			MISE_CEILING_PATHS: fixturesPath,
			// Intentionally disabled so the suite proves the extension itself
			// re-enables the experimental flag when it detects monorepo mode.
			MISE_EXPERIMENTAL: "0",
		},
		installExtensions: ["tombi-toml.tombi"],
		mocha,
	},
]);
