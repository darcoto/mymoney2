const fs = require('fs');
const path = require('path');
const config = require('./config');

const LOG_DIR = path.join(__dirname, '../data');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getTimestamp() {
  return new Date().toISOString();
}

function rotateLogIfNeeded() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        const backupFile = LOG_FILE.replace('.log', `_${Date.now()}.log`);
        fs.renameSync(LOG_FILE, backupFile);
      }
    }
  } catch (error) {
    console.error('Error rotating log file:', error);
  }
}

function writeToLog(level, message, data = null) {
  rotateLogIfNeeded();

  const timestamp = getTimestamp();
  let logLine = `[${timestamp}] [${level}] ${message}`;

  if (data !== null) {
    try {
      logLine += ' ' + JSON.stringify(data);
    } catch (e) {
      logLine += ' [Unable to stringify data]';
    }
  }

  logLine += '\n';

  try {
    fs.appendFileSync(LOG_FILE, logLine);
  } catch (error) {
    console.error('Error writing to log file:', error);
  }

  // Also log to console in development
  if (config.nodeEnv === 'development') {
    console.log(logLine.trim());
  }
}

const logger = {
  info: (message, data = null) => writeToLog('INFO', message, data),
  debug: (message, data = null) => writeToLog('DEBUG', message, data),
  error: (message, data = null) => writeToLog('ERROR', message, data),
  warn: (message, data = null) => writeToLog('WARN', message, data),

  // Get recent log entries
  getRecentLogs: (lines = 100) => {
    try {
      if (!fs.existsSync(LOG_FILE)) {
        return 'No log file found.';
      }
      const content = fs.readFileSync(LOG_FILE, 'utf8');
      const allLines = content.split('\n').filter(l => l.trim());
      return allLines.slice(-lines).join('\n');
    } catch (error) {
      return `Error reading logs: ${error.message}`;
    }
  }
};

module.exports = logger;
