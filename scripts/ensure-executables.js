const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const targets = [
  path.join(root, "dist", "index.js"),
  path.join(root, "dist", "tools", "python", "live_search.py"),
];

const ensureExecutable = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return;
  }
  try {
    const stat = fs.statSync(filePath);
    const mode = stat.mode | 0o111;
    fs.chmodSync(filePath, mode);
  } catch (error) {
    console.warn(`Could not set executable bit for ${filePath}: ${error.message}`);
  }
};

targets.forEach(ensureExecutable);
