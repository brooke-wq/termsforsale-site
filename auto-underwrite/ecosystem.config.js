module.exports = {
  apps: [
    {
      name: 'pdf-render-service',
      script: 'server.js',
      cwd: '/home/brooke/pdf-render-service',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      error_file: '/var/log/pdf-render-service.error.log',
      out_file: '/var/log/pdf-render-service.out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
