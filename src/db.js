import mongoose from 'mongoose';
import { config } from './config.js';

/**
 * Connect to MongoDB with safe defaults.
 * - strictQuery blocks unknown query fields (defence against query injection).
 * - serverSelectionTimeoutMS fails fast instead of hanging on a bad URI.
 * - autoIndex is disabled in production for performance/predictability.
 */
export async function connectDb() {
  mongoose.set('strictQuery', true);

  mongoose.connection.on('error', (err) => {
    console.error('[db] connection error:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('[db] disconnected');
  });

  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 8000,
    maxPoolSize: 10,
    autoIndex: !config.isProd,
  });

  // Never log the credentials in the URI.
  const safeHost = (() => {
    try {
      return new URL(config.mongoUri.replace('mongodb+srv', 'https')).host;
    } catch {
      return 'mongo';
    }
  })();
  console.log(`[db] connected to ${safeHost}`);
}

export async function disconnectDb() {
  await mongoose.connection.close();
}
