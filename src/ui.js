import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

let language = 'en';
export const setLanguage = value => { language = value; };
export const t = (tr, en) => language === 'tr' ? tr : en;

export const interactive = Boolean(stdin.isTTY && stdout.isTTY);
const rich = interactive && process.env.TERM !== 'dumb';
const color = (code, value) =>
  rich && !('NO_COLOR' in process.env) ? `\x1b[${code}m${value}\x1b[0m` : String(value);
export const ui = {
  title: value => color('1;36', value),
  dim: value => color('2', value),
  ok: value => color('32', value),
  warn: value => color('33', value),
  error: value => color('31', value),
};

export const formatHours = seconds =>
  `${new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(seconds / 3600)} ${t('sa', 'h')}`;
export const displayDate = date => new Intl.DateTimeFormat(language, {
  weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
}).format(new Date(date));

function cancelled() {
  const error = new Error(t('İşlem iptal edildi.', 'Cancelled.'));
  error.name = 'AbortError';
  return error;
}

export async function ask(label, fallback = '', { secret = false } = {}) {
  if (!interactive) throw new Error(t('Etkileşimli bir terminal gerekli.', 'An interactive terminal is required.'));
  const rl = createInterface({ input: stdin, output: stdout, historySize: secret ? 0 : 30 });
  const prompt = ui.title(label) + (fallback && !secret ? ui.dim(` [${fallback}]`) : '') + ' › ';
  const controller = new AbortController();
  rl.once('SIGINT', () => rl.close());
  rl.once('close', () => controller.abort());
  try {
    if (!secret) return (await rl.question(prompt, { signal: controller.signal })).trim() || fallback;
    return await new Promise((resolve, reject) => {
      stdout.write(prompt);
      rl.output = undefined;
      controller.signal.addEventListener('abort', () => reject(cancelled()), { once: true });
      rl.once('line', value => {
        stdout.write('\n');
        resolve(value.trim() || fallback);
      });
    });
  } catch (error) {
    if (error.name === 'AbortError') throw cancelled();
    throw error;
  } finally {
    rl.close();
  }
}

export async function select(label, options, { multiple = false, initial = [] } = {}) {
  if (!options.length) return multiple ? [] : null;
  if (!rich) {
    console.log(label);
    options.forEach((option, index) => console.log(`  ${index + 1}. ${option.label}`));
    while (true) {
      const answer = await ask(t('Seçim (0 = geri)', 'Selection (0 = back)'), multiple ? initial.map(i => i + 1).join(',') : '1');
      if (answer === '0') return null;
      const indices = [...new Set(answer.split(',').map(value => Number(value.trim()) - 1))];
      if (indices.every(i => Number.isInteger(i) && i >= 0 && i < options.length) && (multiple || indices.length === 1)) {
        return multiple ? indices.sort((a, b) => a - b).map(i => options[i].value) : options[indices[0]].value;
      }
      console.log(ui.warn(t('Geçerli bir seçim gir.', 'Enter a valid selection.')));
    }
  }

  const selected = new Set(initial);
  const windowSize = Math.min(8, options.length);
  let cursor = 0;
  let first = 0;
  let lines = 0;
  console.log(ui.title(label));
  const clear = () => {
    if (lines) stdout.write(`\x1b[${lines}A\r\x1b[J`);
  };
  const render = () => {
    clear();
    first = Math.max(0, Math.min(first, cursor, options.length - windowSize));
    if (cursor >= first + windowSize) first = cursor - windowSize + 1;
    const rows = options.slice(first, first + windowSize).map((option, index) => {
      const position = first + index;
      const pointer = position === cursor ? ui.title('›') : ' ';
      const mark = multiple ? (selected.has(position) ? ui.ok('● ') : ui.dim('○ ')) : '';
      // Keep one terminal line per option, including in narrow windows.
      const width = Math.max(12, (stdout.columns || 80) - 6);
      const label = option.label.length > width ? option.label.slice(0, width - 1) + '…' : option.label;
      return `  ${pointer} ${mark}${label}`;
    });
    const keys = multiple ? t('↑↓ Gezin · Space Seç · Enter İlerle · Esc Geri', '↑↓ Move · Space Toggle · Enter Continue · Esc Back')
      : t('↑↓ Gezin · Enter Seç · Esc Geri', '↑↓ Move · Enter Select · Esc Back');
    const count = multiple ? ` · ${selected.size} ${t('seçili', 'selected')}` : '';
    rows.push(ui.dim(`    ${keys}${count}`.slice(0, Math.max(12, (stdout.columns || 80) - 1))));
    stdout.write(rows.join('\n') + '\n');
    lines = rows.length;
  };

  emitKeypressEvents(stdin);
  const previousRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  try {
    return await new Promise((resolve, reject) => {
      const onKey = (_, key = {}) => {
        if (key.ctrl && key.name === 'c') {
          stdin.off('keypress', onKey);
          reject(cancelled());
          return;
        }
        if (key.name === 'escape' || key.name === 'return' || key.name === 'enter') {
          if (multiple && key.name !== 'escape' && !selected.size) return;
          stdin.off('keypress', onKey);
          if (key.name === 'escape') resolve(null);
          else if (multiple) resolve([...selected].sort((a, b) => a - b).map(i => options[i].value));
          else resolve(options[cursor].value);
          return;
        }
        if (key.name === 'up') cursor = Math.max(0, cursor - 1);
        else if (key.name === 'down') cursor = Math.min(options.length - 1, cursor + 1);
        else if (multiple && key.name === 'space') {
          if (selected.has(cursor)) selected.delete(cursor);
          else selected.add(cursor);
        } else return;
        render();
      };
      stdin.on('keypress', onKey);
      render();
    });
  } finally {
    clear();
    stdin.setRawMode(Boolean(previousRaw));
    stdin.pause();
  }
}

export async function confirm(label, defaultAnswer = false) {
  const options = [
    { label: t('Vazgeç', 'Cancel'), value: false },
    { label: t('Onayla', 'Confirm'), value: true },
  ];
  return await select(label, defaultAnswer ? options.reverse() : options) === true;
}
