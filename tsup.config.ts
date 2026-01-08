import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "rpc/index": "src/rpc/index.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: true,
  target: "es2020", // BigInt support
  splitting: true, // Code splitting for smaller bundles
  treeshake: true, // Remove unused code
});
