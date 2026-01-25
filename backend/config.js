require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  databasePath: process.env.DATABASE_PATH || './data/finance.db',
  goCardless: {
    secretId: process.env.GOCARDLESS_SECRET_ID,
    secretKey: process.env.GOCARDLESS_SECRET_KEY,
    apiUrl: 'https://bankaccountdata.gocardless.com'
  },
  nodeEnv: process.env.NODE_ENV || 'development'
};
