// PM2 process manager config
// Cara pakai: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'trading-dashboard',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        PORT: 8080,
        NODE_ENV: 'production',
      },
      max_memory_restart: '300M',
      autorestart: true,
      watch: false,
      time: true,
    },
  ],
};
