const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

const MATHJAX = path.join("node_modules", "@mathjax", "src") + path.sep;
const MATHJAX_IMPORTS = Object.entries(require("@mathjax/src/package.json").imports)
  .filter(([key, target]) => key.endsWith("/*") && target.endsWith("/*"))
  .map(([key, target]) => ({ prefix: key.slice(0, -1), target: target.slice(0, -1) }));

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith("#") && context.originModulePath.includes(MATHJAX)) {
    const mapped = MATHJAX_IMPORTS.find(({ prefix }) => moduleName.startsWith(prefix));
    if (mapped !== undefined) {
      return context.resolveRequest(context, mapped.target + moduleName.slice(mapped.prefix.length), platform);
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
