/**
 * PM2 Ecosystem Config — Deal Pros Paperclip AI OS
 *
 * All scheduled jobs run on DigitalOcean via PM2 cron.
 * Each job wraps its corresponding Netlify function.
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 list
 *   pm2 logs underwriting-poller --lines 50
 *   pm2 restart all
 *
 * Environment variables are loaded from /etc/environment
 * (set during droplet provisioning).
 */

module.exports = {
  apps: [
    {
      name: 'underwriting-poller',
      script: './run-job.js',
      args: 'underwriting-poller',
      cron_restart: '*/15 * * * *',
      autorestart: false,
      watch: false,
      max_memory_restart: '150M',
    },
    {
      name: 'deal-package-poller',
      script: './run-job.js',
      args: 'deal-package-poller',
      cron_restart: '*/15 * * * *',
      autorestart: false,
      watch: false,
      max_memory_restart: '150M',
    },
    {
      name: 'lead-intake-poller',
      script: './run-job.js',
      args: 'lead-intake',
      cron_restart: '*/15 * * * *',
      autorestart: false,
      watch: false,
      max_memory_restart: '150M',
    },
    {
      name: 'seller-call-prep-poller',
      script: './run-job.js',
      args: 'seller-call-prep',
      cron_restart: '*/15 * * * *',
      autorestart: false,
      watch: false,
      max_memory_restart: '150M',
    },
    {
      name: 'buyer-relations-poller',
      script: './run-job.js',
      args: 'buyer-relations',
      cron_restart: '*/30 * * * *',
      autorestart: false,
      watch: false,
      max_memory_restart: '150M',
    },
    {
      name: 'dispo-buddy-triage-poller',
      script: './run-job.js',
      args: 'dispo-buddy-triage',
      cron_restart: '*/15 * * * *',
      autorestart: false,
      watch: false,
      max_memory_restart: '150M',
    },
    {
      name: 'notify-buyers-poller',
      script: './run-job.js',
      args: 'notify-buyers',
      cron_restart: '*/30 * * * *',
      autorestart: false,
      watch: false,
      max_memory_restart: '200M',
    },
    {
      name: 'deal-dog-poller',
      script: './run-job.js',
      args: 'deal-dog-poller',
      cron_restart: '0 * * * *',
      autorestart: false,
      watch: false,
      max_memory_restart: '150M',
    },
    {
      name: 'equity-exit-poller',
      script: './run-job.js',
      args: 'equity-exit-intake',
      cron_restart: '*/30 * * * *',
      autorestart: false,
      watch: false,
      max_memory_restart: '150M',
    },
    {
      name: 'ceo-briefing',
      script: './run-job.js',
      args: 'ceo-briefing',
      cron_restart: '0 14 * * *',
      autorestart: false,
      watch: false,
      max_memory_restart: '150M',
    },
    {
      name: 'weekly-synthesis',
      script: './run-job.js',
      args: 'weekly-synthesis',
      cron_restart: '0 15 * * 1',
      autorestart: false,
      watch: false,
      max_memory_restart: '150M',
    },
  ],
};
