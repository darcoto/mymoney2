require('dotenv').config();

const path = require('path');

// DATABASE_NAME: Име на SQLite файла в папка ./data/
// Смяната на тази стойност изисква рестарт на сървъра.
const databaseName = process.env.DATABASE_NAME || 'finance.db';
const databasePath = path.join('./data', databaseName);

module.exports = {
  port: process.env.PORT || 3000,
  databaseName,
  databasePath,
  nodeEnv: process.env.NODE_ENV || 'development'
};
