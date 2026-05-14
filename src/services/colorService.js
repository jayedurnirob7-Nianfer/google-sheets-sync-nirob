/**
 * colorService.js
 * Manages profile → color assignments.
 * Auto-assigns from a pool for any new profile not yet seen.
 */
const fs   = require('fs');
const path = require('path');

const COLOR_MAP_FILE = path.join(__dirname, '../../data/profileColors.json');

// Pre-assigned colors for known profiles
const DEFAULT_COLOR_MAP = {
  'pixelora_studio' : '#cfe2f3',
  'socio_vista'     : '#d9ead3',
  'thestudioxx'     : '#fce5cd',
  'sketchmuse'      : '#fff2cc',
  'ink_byte_studio' : '#e6cff2',
  'graphixnest_'    : '#f4cccc',
  'verispace_'      : '#d0e0e3',
  'vanila_wix'      : '#ead1dc',
  'coppercart_'     : '#f9cb9c',
  'stellarunit'     : '#b6d7a8',
  'shop_vantire'    : '#a2c4c9'
};

// Pool of colors for future profiles (auto-assigned)
const COLOR_POOL = [
  '#c9daf8', '#d9d2e9', '#fce8b2', '#d0f0c0', '#fddcb5',
  '#c6efce', '#ffeb9c', '#e2efda', '#dce6f1', '#fde9d9',
  '#e8d5b7', '#c5e0b4', '#bdd7ee', '#f2dcdb', '#e2d9f3',
  '#fef2cb', '#d6dce4', '#fce4d6', '#cce5ff', '#d4edda'
];

function loadColorMap() {
  try {
    if (fs.existsSync(COLOR_MAP_FILE)) {
      return JSON.parse(fs.readFileSync(COLOR_MAP_FILE, 'utf8'));
    }
  } catch (_) {}
  return { ...DEFAULT_COLOR_MAP };
}

function saveColorMap(map) {
  const dir = path.dirname(COLOR_MAP_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(COLOR_MAP_FILE, JSON.stringify(map, null, 2));
}

function getColor(profileName, colorMap) {
  const key = (profileName || '').trim().toLowerCase();
  if (!key) return '#ffffff';
  if (colorMap[key]) return colorMap[key];

  // Auto-assign: pick first pool color not already used
  const usedColors = new Set(Object.values(colorMap));
  const next = COLOR_POOL.find(c => !usedColors.has(c))
    || COLOR_POOL[Object.keys(colorMap).length % COLOR_POOL.length];

  colorMap[key] = next;
  saveColorMap(colorMap);
  return next;
}

function hexToSheetsRgb(hex) {
  return {
    red:   parseInt(hex.slice(1, 3), 16) / 255,
    green: parseInt(hex.slice(3, 5), 16) / 255,
    blue:  parseInt(hex.slice(5, 7), 16) / 255
  };
}

module.exports = { loadColorMap, saveColorMap, getColor, hexToSheetsRgb };
