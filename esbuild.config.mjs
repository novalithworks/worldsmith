import esbuild from 'esbuild';
import process from 'process';
import { builtinModules } from 'node:module';

const banner = `/*
WORLDSMITH — generated bundle. Source: src/
*/
`;

const prod = process.argv[2] === 'production';

/**
 * Two build contexts:
 *  - main.js    : the plugin (TypeScript → CJS, Obsidian provides `obsidian` at runtime)
 *  - styles.css : all scoped stylesheets under src/styles, concatenated via @import
 */
const jsContext = await esbuild.context({
	banner: { js: banner },
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: [
		'obsidian',
		'electron',
		'@codemirror/autocomplete',
		'@codemirror/collab',
		'@codemirror/commands',
		'@codemirror/language',
		'@codemirror/lint',
		'@codemirror/search',
		'@codemirror/state',
		'@codemirror/view',
		'@lezer/common',
		'@lezer/highlight',
		'@lezer/lr',
		...builtinModules,
	],
	format: 'cjs',
	target: 'es2021',
	logLevel: 'info',
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	outfile: 'main.js',
	minify: prod,
	// Native-note styling is imported as text: Worldsmith applies it and writes it into the
	// notes' CSS snippet (src/notes-css/).
	loader: { '.css': 'text' },
	// The edition (0.30): WS_EDITION=free (the community directory, the default) or pro.
	define: { __EDITION__: JSON.stringify(process.env.WS_EDITION === 'pro' ? 'pro' : 'free') },
});

const cssContext = await esbuild.context({
	entryPoints: ['src/styles/index.css'],
	bundle: true,
	logLevel: 'info',
	outfile: 'styles.css',
	minify: false,
});

if (prod) {
	await jsContext.rebuild();
	await cssContext.rebuild();
	process.exit(0);
} else {
	await Promise.all([jsContext.watch(), cssContext.watch()]);
}
