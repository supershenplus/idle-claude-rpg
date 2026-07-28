'use strict';

// The /hero skill names the CLI by absolute path twice — once in the
// `allowed-tools` frontmatter, which is a permission grant and so cannot be a
// relative path or a variable, and once in the body. Those paths are wherever
// *this* clone happens to sit, so the file in the repo carries a {{REPO}}
// placeholder and the installer renders it.
//
// It was previously checked in with the original author's home directory baked
// in, which meant `install.sh` handed every other person on earth a /hero skill
// pointing into a directory they don't have.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'skill', 'SKILL.md');

function render(repo = REPO) {
  return fs.readFileSync(SRC, 'utf8').split('{{REPO}}').join(repo);
}

module.exports = { render, SRC, REPO };
