// src/utils/cache.js
const NodeCache = require('node-cache');
const config = require('../config/config');
const logger = require('./logger');

const cache = new NodeCache({ stdTTL: config.cacheTTL, checkperiod: 600 });

class CacheManager {
  static get(key) {
    const value = cache.get(key);
    if (value) {
      logger.debug(`Cache hit: ${key}`);
    }
    return value;
  }

  static set(key, value, ttl = null) {
    cache.set(key, value, ttl || config.cacheTTL);
    logger.debug(`Cache set: ${key}`);
  }

  static del(key) {
    cache.del(key);
    logger.debug(`Cache deleted: ${key}`);
  }

  static flush() {
    cache.flushAll();
    logger.info('Cache flushed');
  }

  static generateKey(...parts) {
    return parts.join(':').replace(/[^a-zA-Z0-9:-]/g, '_');
  }
}

module.exports = { CacheManager };
