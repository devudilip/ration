import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: [
    { in: 'src/background/index.ts', out: 'background' },
    { in: 'src/popup/main.ts', out: 'popup' },
  ],
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
};

async function copyStatic() {
  await mkdir('dist', { recursive: true });
  await cp('public', 'dist', { recursive: true });
}

await rm('dist', { recursive: true, force: true });
await copyStatic();

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching src/ — reload the extension from chrome://extensions after changes');
} else {
  await esbuild.build(options);
}
