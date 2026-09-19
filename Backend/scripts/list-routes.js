const app = require('../src/app');

function listRoutes(stack, prefix = '') {
  for (const layer of stack) {
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
      console.log(`${methods} ${prefix}${layer.route.path}`);
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      listRoutes(layer.handle.stack, prefix);
    }
  }
}

if (app && app._router && app._router.stack) {
  console.log('Top-level routes:');
  listRoutes(app._router.stack);
} else {
  console.log('No routes found');
}
