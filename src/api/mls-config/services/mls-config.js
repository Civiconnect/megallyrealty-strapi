'use strict';

/**
 * mls-config service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::mls-config.mls-config');
