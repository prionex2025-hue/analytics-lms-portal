const monitoring = require('../src/routes/SuperAdmin/monitoring.routes');

function listRouter(r, prefix=''){
  console.log('Router stack:');
  for(const layer of r.stack){
    if(layer.route){
      console.log(Object.keys(layer.route.methods).join(',').toUpperCase(), prefix + layer.route.path);
    } else if(layer.name === 'router' && layer.handle && layer.handle.stack){
      listRouter(layer.handle, prefix + (layer.regexp && layer.regexp.source ? layer.regexp.source : ''));
    } else {
      // middleware
    }
  }
}

listRouter(monitoring);
