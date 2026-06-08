// pm2 ecosystem config — Lark Claude Bridge + Dashboard
// Usage:
//   pm2 start bridge/ops/ecosystem.config.cjs
//   pm2 stop all / pm2 restart all / pm2 logs
//
// Prerequisites: pm2 installed globally (npm i -g pm2)
// Logs dir: ~/lark-bridge-logs/ (created on first run)

const path = require("path");
const HOME = process.env.HOME || require("os").homedir();
const REPO_ROOT = path.resolve(__dirname, "../..");
const BRIDGE_DIR = path.join(REPO_ROOT, "bridge");
const DASHBOARD_DIR = path.join(REPO_ROOT, "dashboard");
const LOGS_DIR = path.join(HOME, "lark-bridge-logs");

module.exports = {
  apps: [
    {
      // ── Bridge daemon ───────────────────────────────────────────────
      name: "lark-bridge",
      script: "npm",
      args: "run start",
      cwd: BRIDGE_DIR,
      interpreter: "none",  // npm handles its own shell

      // Restart policy
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",      // must stay up 10s to count as a successful start
      restart_delay: 3000,    // ms between restarts
      exp_backoff_restart_delay: 100,

      // Environment
      env: {
        NODE_ENV: "production",
      },

      // Logs
      out_file: path.join(LOGS_DIR, "bridge-out.log"),
      error_file: path.join(LOGS_DIR, "bridge-err.log"),
      merge_logs: false,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      max_memory_restart: "512M",

      // Source maps for tsx
      source_map_support: true,
      watch: false,
    },
    {
      // ── Next.js Dashboard ───────────────────────────────────────────
      name: "lark-dashboard",
      script: "npm",
      args: "run start",
      cwd: DASHBOARD_DIR,
      interpreter: "none",

      autorestart: true,
      max_restarts: 10,
      min_uptime: "5s",
      restart_delay: 5000,

      env: {
        NODE_ENV: "production",
        PORT: "9820",
      },

      out_file: path.join(LOGS_DIR, "dashboard-out.log"),
      error_file: path.join(LOGS_DIR, "dashboard-err.log"),
      merge_logs: false,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      max_memory_restart: "256M",

      watch: false,
    },
  ],
};
