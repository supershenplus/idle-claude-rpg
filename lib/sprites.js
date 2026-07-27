'use strict';

// Hero sprites + projectile styling per class. Monster sprites live in content.js.

const heroes = {
  wizard: { idle: '(∩｀-´)⊃', proj: '☆ﾟ.*', trail: '━' },
  knight: { idle: '[è_é]o', proj: '≫', trail: '=' },
  rogue:  { idle: '(¬‿¬)⌐', proj: '╫', trail: '─' },
  ranger: { idle: '(๑•̀ᴗ•́)', proj: '➳', trail: '-' },
};

const DEAD_MONSTER = '(x_x)';

// Frame period for all animations (ms per frame)
const FRAME_MS = 250;

module.exports = { heroes, DEAD_MONSTER, FRAME_MS };
