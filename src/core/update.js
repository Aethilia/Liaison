'use strict';

// Mises à jour par le dossier commun : on y dépose le nouvel installateur dans
// « mises-a-jour/ » et chaque poste le détecte au démarrage.

const fs = require('fs');
const path = require('path');
const { compareVersions } = require('./model');

const UPDATE_DIR = 'mises-a-jour';
const PATTERNS = {
  installation: /^Liaison-Installation-(\d+)\.(\d+)\.(\d+)\.exe$/i,
  portable: /^Liaison-Portable-(\d+)\.(\d+)\.(\d+)\.exe$/i,
};

// Renvoie la version la plus récente disponible pour ce type d'installation
// ({ version, file }), ou null si le poste est déjà à jour.
function findUpdate(dataDir, currentVersion, kind = 'installation') {
  const dir = path.join(dataDir, UPDATE_DIR);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  let best = null;
  for (const name of names) {
    const m = PATTERNS[kind].exec(name);
    if (!m) continue;
    const version = `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}`;
    if (compareVersions(version, currentVersion) <= 0) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { version, file: path.join(dir, name) };
  }
  return best;
}

module.exports = { UPDATE_DIR, compareVersions, findUpdate };
