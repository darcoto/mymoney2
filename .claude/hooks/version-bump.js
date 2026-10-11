const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const command = data.tool_input?.command || '';

    if (!/^git commit/.test(command)) {
      process.exit(0);
    }

    const versionFile = path.join(process.env.CLAUDE_PROJECT_DIR || '.', 'VERSION');
    const current = fs.readFileSync(versionFile, 'utf8').trim();
    const parts = current.split('.');
    const major = parts[0];
    const minor = parseInt(parts[1] || '0', 10) + 1;
    const newVersion = `${major}.${minor}`;

    fs.writeFileSync(versionFile, newVersion);

    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: {
          command: `git add VERSION && ${command}`
        },
        additionalContext: `Version: ${current} -> ${newVersion}`
      }
    };
    process.stdout.write(JSON.stringify(output));
  } catch (e) {
    process.exit(0);
  }
});
