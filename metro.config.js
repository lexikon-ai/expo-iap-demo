// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// added for hono, but will become default in expo anyway
//
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
