// Type-checks the ```ts samples of Markdown pages against the gateway's sources, as a developer pastes them:
// `pnpm docs:check-samples [folder…]` (default: docs/24-learning-paths). Exits non-zero on the first type error.
//
// Each example of a page becomes one .ts file under temp/check-doc-samples/, nothing else in it:
//   - a page with a `### 8.0` chapter: one file per `### 8.N` example, holding the samples of 8.0 and then those of 8.N,
//     in page order, at the top level of one module (what a developer gets by pasting the two into a file). An example
//     that declares its own `const gateway` replaces the `const gateway = new AIGateway(config);` line of 8.0.
//   - any other page: one file with all its samples
//   - the imports of the samples are merged at the top; `dyna-ai-gateway` and `dyna-ai-gateway/vercel-ui` resolve to
//     packages/dyna-ai-gateway/src, so a sample is checked against the code as it is now, not against the last build
// There is no prelude: what an example takes from your application is a `declare` line of the example itself.

import {execFileSync} from 'node:child_process';
import {mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const gatewayDir = path.join(root, 'packages', 'dyna-ai-gateway');
const outDir = path.join(root, 'temp', 'check-doc-samples');
const folders = process.argv.length > 2 ? process.argv.slice(2) : ['docs/24-learning-paths'];

const importStatement = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)";\n?/g;
const gatewayLine = /^const gateway = new AIGateway\(config\);\n?/m;

const samplesOf = (markdown) => [...markdown.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1]);

// One module: the merged imports, then the samples in order
const moduleOf = (samples) => {
  const imports = new Map();
  const bodies = samples.map((sample) => sample.replace(importStatement, (statement, names, module) => {
    const set = imports.get(module) ?? new Set();
    names.split(',').map((name) => name.trim()).filter(Boolean).forEach((name) => set.add(name));
    imports.set(module, set);
    return '';
  }));
  return [
    '/* eslint-disable */',
    ...[...imports].map(([module, names]) => `import {${[...names].sort().join(', ')}} from "${module}";`),
    'export {};',
    ...bodies,
    '',
  ].join('\n');
};

// The examples of a page: [{id, source}]
const examplesOf = (markdown) => {
  const chapters = markdown.split(/^(?=### 8\.\d+ )/m).slice(1).map((chapter) => ({
    id: chapter.match(/^### (8\.\d+) /)[1],
    samples: samplesOf(chapter.split(/^## /m)[0]),
  }));
  const setup = chapters.find(({id}) => id === '8.0');
  if (!setup) {
    const samples = samplesOf(markdown);
    return samples.length ? [{id: 'page', source: moduleOf(samples)}] : [];
  }
  return chapters.filter(({id}) => id !== '8.0').map(({id, samples}) => {
    const ownGateway = samples.some((sample) => /^const gateway\b/m.test(sample));
    const setupSamples = ownGateway ? setup.samples.map((sample) => sample.replace(gatewayLine, '')) : setup.samples;
    return {id, source: moduleOf([...setupSamples, ...samples])};
  });
};

rmSync(outDir, {recursive: true, force: true});
mkdirSync(outDir, {recursive: true});

let files = 0;
for (const folder of folders) {
  const dir = path.resolve(root, folder);
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.md')).sort()) {
    for (const {id, source} of examplesOf(readFileSync(path.join(dir, file), 'utf8'))) {
      const name = `${path.basename(folder)}__${file.slice(0, -3)}__${id}`.replace(/[^\w]/g, '_');
      writeFileSync(path.join(outDir, `${name}.ts`), source);
      files++;
    }
  }
}

const gatewayModules = path.join(gatewayDir, 'node_modules');
writeFileSync(path.join(outDir, 'tsconfig.json'), JSON.stringify({
  extends: path.join(root, 'tsconfig.base.json'),
  compilerOptions: {
    noEmit: true,
    noUnusedLocals: false,
    noUnusedParameters: false,
    target: 'es2022', // the examples await at the top level, as a module on Node 24 does
    baseUrl: '.',
    typeRoots: [path.join(root, 'node_modules', '@types')],
    types: ['node'],
    paths: {
      'dyna-ai-gateway': [path.join(gatewayDir, 'src', 'index.ts')],
      'dyna-ai-gateway/vercel-ui': [path.join(gatewayDir, 'src', 'entries', 'vercel-ui', 'index.ts')],
      '*': [path.join(gatewayModules, '*'), path.join(root, 'node_modules', '*')],
    },
  },
  include: ['*.ts'],
}, null, 2));

console.log(`check-doc-samples: ${files} example file(s) from ${folders.join(', ')} → ${path.relative(root, outDir)}`);
try {
  execFileSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', outDir], {stdio: 'inherit'});
  console.log('check-doc-samples: 0 errors');
} catch {
  console.error('check-doc-samples: type errors above (the files are kept in temp/check-doc-samples)');
  process.exit(1);
}
