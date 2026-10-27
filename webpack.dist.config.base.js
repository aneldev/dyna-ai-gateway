const fs = require('fs');
const path = require('path');
const nodeExternals = require('webpack-node-externals');
const buffer = require.resolve("buffer");

const loaders = require('./webpack.loaders.js');
const plugins = require('./webpack.plugins.js');

/**
 * The dist build of one package of the workspace (the dyna-ts-module-boilerplate build, shared by every package).
 * A package's webpack.dist.config.js is one call:
 *   module.exports = require('../../webpack.dist.config.base.js')(packageDir, {entries: {'vercel-ui': 'src/entries/vercel-ui/index.ts'}});
 * `packageDir` is the package folder (its package.json, src and dist); `entries` are its subpath entries next to
 * src/index.ts, named as in the package.json `exports` (none by default).
 */
module.exports = (packageDir, {entries = {}} = {}) => {

const isSingleModule =
  fs.existsSync(path.join(packageDir, 'src/index.ts')) ||
  fs.existsSync(path.join(packageDir, 'src/index.tsx'));

const package_ = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));

/**
 * Exclude src/? folders when not in single mode
 * @type {string[]}
 */
const EXCLUDE_SRC_FOLDERS = [
  "@types",
  // Other folders that won't be built by Webpack might be listed here
];

const getModuleNames =
  root =>
    fs.readdirSync(root, {withFileTypes: true})
      .filter(dirent => dirent.isDirectory())
      .filter(dirent => !EXCLUDE_SRC_FOLDERS.includes(dirent.name))
      .map(dirent => dirent.name);

const moduleNames = getModuleNames(path.join(packageDir, 'src'));

process.traceDeprecation = true;

const entry =
  isSingleModule
    ? (
      // Classic export of the /src/index.ts, plus the subpath entries of the package.json `exports`
      Object.entries({index: 'src/index.ts', ...entries})
        .reduce((acc, [name, file]) => {
          acc[name] = path.resolve(packageDir, file);
          return acc;
        }, {})
    )
    : (
      // Multiple module exports of the /src/<Module name>/index.ts
      moduleNames
        .reduce((acc, entry) => {
          acc[entry] = path.join(packageDir, 'src', entry);
          return acc;
        }, {})
    );

/**
 * The package is distributed in two formats, built by two webpack configs:
 * - `umd`: dist/index.js — loadable via `require()` (CommonJS), AMD or a <script> tag
 * - `esm`: dist/index.mjs — native `import`, tree-shakeable by consumer bundlers
 * The `exports` map of the package.json routes the consumers to the right file.
 */
const createConfig = format => ({
  mode: "development",          // distribute it without minification
  target:
    format === 'esm'
      ? ['node', 'es2022']      // es2022 environment is needed for module output
      : "node",
  entry,
  externals: [
    nodeExternals(
      format === 'esm'
        ? {importType: 'module'}  // reference externals with `import` instead of `require`
        : undefined,
    ),
    // A subpath entry (src/<module>/index.ts) reaches the gateway through the root barrel (".."): keep it external, as the
    // package's own main entry, so the gateway's code is bundled once and both entries share the same classes
    ({context, request}, callback) => {
      const srcRoot = path.resolve(packageDir, 'src');
      const target = request.startsWith('.') ? path.resolve(context, request) : '';
      const isRootBarrel = target === srcRoot || target === path.join(srcRoot, 'index');
      const isSubpathEntry = context !== srcRoot && context.startsWith(`${srcRoot}${path.sep}`);
      if (isSingleModule && isSubpathEntry && isRootBarrel) {
        return callback(null, `${format === 'esm' ? 'module' : 'commonjs'} ${package_.name}`);
      }
      callback();
    },
  ],
  experiments: {
    outputModule: format === 'esm',
  },
  optimization: {
    // help: https://webpack.js.org/guides/tree-shaking/
    usedExports: true,  // true to remove the dead code,
  },
  devtool: "source-map",        // help: https://webpack.js.org/configuration/devtool/
  // Every folder of ./src is a standalone exported module
  output: {
    path: path.resolve(packageDir, 'dist'),
    publicPath: '/dist/',
    filename:
      isSingleModule
        ? `[name].${format === 'esm' ? 'mjs' : 'js'}`             // dist/index.js and one file per subpath entry
        : `[name]/${format === 'esm' ? 'index.mjs' : 'index.js'}`, // Multiple module exports of the /src/<Module name>/index.ts
    library:
      format === 'esm'
        ? {type: 'module'}
        : {
          name: package_.name,
          type: 'umd',
          umdNamedDefine: true,
        },
    // No `clean` here: both configs emit into ./dist in parallel and would
    // delete each other's output; the build scripts rimraf ./dist instead.
  },
  resolve: {
    alias: {},
    extensions: [".webpack.js", ".web.js", ".ts", ".tsx", ".js", ".jsx"],
    fallback: {
      stream: buffer,
    }
  },
  module: {
    rules: loaders.module.rules,
  },
  // The d.ts build and the circular-dependency check need to run only once,
  // so the plugins are applied to the UMD config only
  plugins: format === 'umd' ? plugins.plugins : [],
});

return [
  createConfig('umd'),
  createConfig('esm'),
];

};
