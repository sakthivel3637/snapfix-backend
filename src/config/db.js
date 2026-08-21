const { PrismaClient } = require('@prisma/client');

if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('${')) {
  const user = encodeURIComponent(process.env.DB_USER || 'postgres');
  const pass = encodeURIComponent(process.env.DB_PASSWORD || '');
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const db = process.env.DB_DATABASE || 'snapfix';
  process.env.DATABASE_URL = `postgresql://${user}:${pass}@${host}:${port}/${db}?sslmode=prefer`;
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

module.exports = prisma;
