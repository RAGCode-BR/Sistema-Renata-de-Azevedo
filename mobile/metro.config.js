// Metro: o app também lê o código compartilhado com a web (pasta ../shared: tipos, permissões e acesso aos dados).
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../shared')];
module.exports = config;
