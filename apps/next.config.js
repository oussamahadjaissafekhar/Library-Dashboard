//@ts-check

// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');

let composePlugins;
let withNx;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ composePlugins, withNx } = require('@nx/next'));
} catch {
  // Fallback to allow running the app with plain Next.js (without Nx installed)
  composePlugins = (...plugins) => (config) => plugins.reduce((acc, plugin) => plugin(acc), config);
  withNx = (config) => config;
}

/**
 * @type {import('@nx/next/plugins/with-nx').WithNxOptions}
 **/
const nextConfig = {
  // Use this to set Nx-specific options
  // See: https://nx.dev/recipes/next/next-config-setup
  turbopack: {
    root: path.resolve(__dirname, '..', '..'),
  },
};

const plugins = [
  // Add more Next.js plugins to this list if needed.
  withNx,
];

module.exports = composePlugins(...plugins)(nextConfig);
