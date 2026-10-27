// The boilerplate build of the workspace root; this package adds the subpath entries of its package.json `exports`
module.exports = require('../../webpack.dist.config.base.js')(__dirname, {
  entries: {
    'vercel-ui': 'src/entries/vercel-ui/index.ts',
  },
});
