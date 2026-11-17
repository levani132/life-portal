import { THEME_ROLES, THEME_V0 } from '@life-portal/shared-types';
import { colourToHex, completeValues, contrastRatio, hexToColour, themeBootScript, themeCss, themeProblems, THEME_STORAGE_KEY, validColour, valuesProblem } from './theme';

describe('validColour', () => {
  it('accepts exactly three numbers from 0 to 255, and nothing else', () => {
    for (const good of ['0 0 0', '255 255 255', '12 140 7']) expect(validColour(good)).toBe(true);
    for (const bad of ['256 0 0', '1 2', '1 2 3 4', '1,2,3', ' 1 2 3', '1 2 3;', 'red', '#fff', 'rgb(1 2 3)', '1 2 3}body{display:none', '', null, 12, '1  2 3', '-1 2 3', '1.5 2 3']) {
      expect(validColour(bad)).toBe(false);
    }
  });
});

describe('completeValues', () => {
  it('fills a missing or invalid role from v0 and drops unknown keys', () => {
    const values = completeValues({ surface: '1 2 3', ink: 'nonsense', unknown: '9 9 9' }, 'dark');
    expect(values['surface']).toBe('1 2 3');
    expect(values['ink']).toBe(THEME_V0.dark['ink']);
    expect(values['unknown']).toBeUndefined();
    expect(Object.keys(values)).toEqual(THEME_ROLES.map((role) => role.id));
  });
});

describe('valuesProblem', () => {
  it('names an unknown role and a value that is not a colour', () => {
    expect(valuesProblem({ surface: '1 2 3' })).toBeNull();
    expect(valuesProblem({ nope: '1 2 3' })).toMatch(/not a colour role/);
    expect(valuesProblem({ surface: 'url(x)' })).toMatch(/three numbers/);
    expect(valuesProblem(null)).not.toBeNull();
    expect(valuesProblem([])).not.toBeNull();
  });
});

describe('themeCss', () => {
  it('declares every role for light, explicit dark and system dark, and only that', () => {
    const css = themeCss(THEME_V0);
    expect(css.startsWith('html:root{--surface:245 247 250;')).toBe(true);
    expect(css).toContain("html:root[data-theme='dark']{--surface:12 14 20;");
    expect(css).toContain("@media (prefers-color-scheme: dark){html:root:not([data-theme='light']){--surface:12 14 20;");
    // Three blocks, each with every role once.
    expect(css.match(/--ink:/g)).toHaveLength(3);
    // Nothing but role declarations of digits can appear.
    expect(css.replace(/--[a-z-]+:\d{1,3} \d{1,3} \d{1,3};/g, '')).toBe("html:root{}html:root[data-theme='dark']{}@media (prefers-color-scheme: dark){html:root:not([data-theme='light']){}}");
  });

  it('cannot be made to emit anything else by a hostile value', () => {
    const css = themeCss({ light: { surface: '1 2 3;}body{display:none}', 'x}': '1 2 3' }, dark: {} });
    expect(css).not.toContain('display');
    expect(css).toContain(`--surface:${THEME_V0.light['surface']};`);
  });
});

describe('readability', () => {
  it('measures contrast as WCAG does', () => {
    expect(contrastRatio('0 0 0', '255 255 255')).toBeCloseTo(21, 5);
    expect(contrastRatio('255 255 255', '255 255 255')).toBe(1);
    expect(contrastRatio('119 119 119', '255 255 255')).toBeCloseTo(4.48, 2);
  });

  it('passes v0 on body text, and names what an unreadable theme fails, per mode', () => {
    const bodyText = themeProblems(THEME_V0).filter((problem) => /^Text on/.test(problem.what));
    expect(bodyText).toEqual([]);
    const broken = themeProblems({ light: { ink: THEME_V0.light['surface'] }, dark: THEME_V0.dark });
    expect(broken).toContainEqual({ mode: 'light', what: 'Text on the page background', ratio: 1, min: 4.5 });
    expect(broken.some((problem) => problem.mode === 'dark' && /^Text on/.test(problem.what))).toBe(false);
  });
});

describe('hex', () => {
  it('converts both ways', () => {
    expect(colourToHex('12 14 20')).toBe('#0c0e14');
    expect(hexToColour('#0C0E14')).toBe('12 14 20');
    expect(hexToColour('f5f7fa')).toBe('245 247 250');
    expect(hexToColour('nope')).toBeUndefined();
  });
});

describe('themeBootScript', () => {
  function run(kept: string | null) {
    const added: { id: string; textContent: string }[] = [];
    const document = { createElement: () => ({ id: '', textContent: '' }), head: { appendChild: (el: { id: string; textContent: string }) => added.push(el) } };
    const localStorage = { getItem: (key: string) => (key === THEME_STORAGE_KEY ? kept : null) };
    new Function('document', 'localStorage', themeBootScript())(document, localStorage);
    return added;
  }
  const theme = { id: 'x', version: 2, light: { ...THEME_V0.light, ink: '0 0 0' }, dark: { ...THEME_V0.dark, surface: '0 0 0' } };

  it('applies the kept theme exactly as themeCss would', () => {
    const [style] = run(JSON.stringify(theme));
    expect(style.id).toBe('lp-theme');
    expect(style.textContent).toBe(themeCss(theme));
  });

  it('applies nothing when no theme is kept or it cannot be read', () => {
    expect(run(null)).toEqual([]);
    expect(run('{not json')).toEqual([]);
    expect(run('"text"')).toEqual([]);
  });

  it('leaves out a value that is not a colour, so v0 shows for that role', () => {
    const [style] = run(JSON.stringify({ light: { ...THEME_V0.light, ink: '0 0 0;}body{display:none', surface: '300 0 0' }, dark: {} }));
    expect(style.textContent).not.toContain('display');
    expect(style.textContent).not.toContain('--ink:0');
    expect(style.textContent).not.toContain('300');
    expect(style.textContent).toContain('--border:');
  });
});
