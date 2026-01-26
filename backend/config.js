require('dotenv').config();

const useDemo = process.env.USE_DEMO_DB === 'true';
const defaultDbPath = useDemo ? './data/demo.db' : './data/finance.db';

module.exports = {
  port: process.env.PORT || 3000,
  databasePath: process.env.DATABASE_PATH || defaultDbPath,
  useDemoDb: useDemo,
  goCardless: {
    secretId: process.env.GOCARDLESS_SECRET_ID,
    secretKey: process.env.GOCARDLESS_SECRET_KEY,
    apiUrl: 'https://bankaccountdata.gocardless.com'
  },
  nodeEnv: process.env.NODE_ENV || 'development'
};
