// 打字 / 删字音效：全局委托到 document，只对文本输入目标发声。
// 声音本身在 sfx.keyPress / sfx.keyBack 里做了节流，长按不会变成噪音。
import { isTypingTarget } from '../lib/dom.js';
import * as sfx from './sfx.js';

let bound = false;

function textTarget(target) {
  if (!target || !target.closest) return false;
  // select 不算打字；其余输入框与 contenteditable 都算。
  if (target.tagName === 'SELECT') return false;
  return isTypingTarget(target);
}

export function bindTypingSounds() {
  if (bound) return;
  bound = true;

  document.addEventListener(
    'input',
    (event) => {
      if (event.isComposing) return;
      if (!textTarget(event.target)) return;
      sfx.keyPress();
    },
    true
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      if (!textTarget(event.target)) return;
      sfx.keyBack();
    },
    true
  );
}