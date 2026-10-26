const http = require('node:http');
const request = http.get(
  {
    host:
      process.env.OPS_HOST === '::'
        ? '::1'
        : process.env.OPS_HOST && process.env.OPS_HOST !== '0.0.0.0'
          ? process.env.OPS_HOST
          : '127.0.0.1',
    port: Number(process.env.OPS_PORT || 8821),
    path: '/healthz',
    timeout: 3000,
  },
  response => {
    response.resume();
    process.exitCode = response.statusCode === 200 ? 0 : 1;
  },
);
request.on('timeout', () => request.destroy());
request.on('error', () => {
  process.exitCode = 1;
});
