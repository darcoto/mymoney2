#!/usr/bin/env node

const { program } = require('commander');
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');

const packageRoot = path.resolve(__dirname, '..');
const pkg = require(path.join(packageRoot, 'package.json'));

program
  .name('mymoney2')
  .description('Personal finance management application with GoCardless integration')
  .version(pkg.version)
  .option('-p, --port <number>', 'port to run the server on', parseInt)
  .option('--no-open', 'do not open the browser automatically')
  .parse(process.argv);

const opts = program.opts();

// Set PORT env var if specified via CLI
const env = Object.assign({}, process.env);
if (opts.port) {
  env.PORT = String(opts.port);
}

const serverScript = path.join(packageRoot, 'backend', 'server.js');

if (!fs.existsSync(serverScript)) {
  console.error('Error: Could not find server.js at', serverScript);
  process.exit(1);
}

// Fork the server process with cwd set to packageRoot
// This ensures all relative paths (database, .env, etc.) resolve correctly
const child = fork(serverScript, [], {
  cwd: packageRoot,
  env: env,
  stdio: ['pipe', 'pipe', 'pipe', 'ipc']
});

let serverStarted = false;

child.stdout.on('data', (data) => {
  const output = data.toString();
  process.stdout.write(output);

  // Detect server startup message and open browser
  if (!serverStarted && output.includes('MyMoney2 server running')) {
    serverStarted = true;
    const port = opts.port || env.PORT || 3000;
    const url = `http://localhost:${port}`;

    if (opts.open !== false) {
      import('open').then((mod) => {
        const open = mod.default;
        open(url).catch(() => {
          // Silently ignore if browser can't be opened
        });
      }).catch(() => {
        // Silently ignore if open module fails
      });
    }
  }
});

child.stderr.on('data', (data) => {
  process.stderr.write(data);
});

child.on('error', (err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code || 0);
});

// Graceful shutdown
function shutdown() {
  if (child && !child.killed) {
    child.kill('SIGTERM');
    // Force kill after 5 seconds
    setTimeout(() => {
      if (child && !child.killed) {
        child.kill('SIGKILL');
      }
    }, 5000);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Windows-specific: ensure child is killed on exit
process.on('exit', () => {
  if (child && !child.killed) {
    child.kill();
  }
});
