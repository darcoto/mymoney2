require('dotenv').config();

const path = require('path');

// DATABASE_NAME: Име на SQLite файла в папка ./data/
// Смяната на тази стойност изисква рестарт на сървъра.
const databaseName = process.env.DATABASE_NAME || 'finance.db';
const databasePath = path.join('./data', databaseName);

module.exports = {
  port: process.env.PORT || 3456,
  // HOST: на кой адрес да слуша. 0.0.0.0 = всички интерфейси (по подразбиране),
  // 127.0.0.1 = само локално (когато пред приложението стои reverse proxy).
  host: process.env.HOST || "0.0.0.0",
  databaseName,
  databasePath,
  nodeEnv: process.env.NODE_ENV || 'development'
};
