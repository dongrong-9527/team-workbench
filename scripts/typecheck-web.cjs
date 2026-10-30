// Vue's language-tools currently consumes the TypeScript 6 compiler API.
// Keep the API/build compiler on pinned TypeScript 7; check every SFC with a
// separate, exact compatible compiler instead of skipping template diagnostics.
require("vue-tsc").run(require.resolve("typescript-sfc/lib/tsc"));
