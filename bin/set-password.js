#!/usr/bin/env node
// Задава паролата за уеб достъпа (при забравена парола или първоначално):
//   node bin/set-password.js <нова парола>
//   node bin/set-password.js --off          (маха паролата — свободен достъп)
// Базата е от .env / DATABASE_NAME, както при сървъра. Работещият сървър я вижда до 5 секунди.
process.chdir(require('path').join(__dirname, '..'));
const database = require('../backend/database');
const auth = require('../backend/auth');

(async () => {
    const arg = process.argv[2];
    if (!arg) {
        console.error('Употреба: node bin/set-password.js <нова парола> | --off');
        process.exit(1);
    }
    if (arg !== '--off' && arg.length < 8) {
        console.error('Паролата трябва да е поне 8 знака');
        process.exit(1);
    }
    await database.initialize();
    await auth.setPassword(arg === '--off' ? null : arg);
    console.log(arg === '--off' ? 'Паролата е махната.' : 'Паролата е зададена.');
    process.exit(0);
})().catch(error => {
    console.error(error.message);
    process.exit(1);
});
