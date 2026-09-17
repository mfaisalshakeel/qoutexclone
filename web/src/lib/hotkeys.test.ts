import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BINDINGS,
  actionFor,
  bindingFromEvent,
  bindingsEqual,
  conflicts,
  formatBinding,
  isTyping,
  loadPreferences,
  matches,
  savePreferences,
} from './hotkeys';

const press = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

describe('reading a keystroke', () => {
  it('records the key and the modifiers held with it', () => {
    expect(bindingFromEvent(press({ key: 'w' }))).toEqual({ key: 'w' });
    expect(bindingFromEvent(press({ key: 'k', ctrlKey: true }))).toEqual({ key: 'k', ctrl: true });
    expect(bindingFromEvent(press({ key: 'Enter', shiftKey: true }))).toEqual({
      key: 'Enter',
      shift: true,
    });
  });

  it('treats Cmd as Ctrl, so a Mac binding works', () => {
    expect(bindingFromEvent(press({ key: 'k', metaKey: true }))).toEqual({ key: 'k', ctrl: true });
  });

  it('does not record shift for a printable key, since it is already in the character', () => {
    // shift+/ produces "?", and storing both would never match
    expect(bindingFromEvent(press({ key: '?', shiftKey: true }))).toEqual({ key: '?' });
  });

  it('ignores a modifier pressed on its own', () => {
    for (const key of ['Control', 'Shift', 'Alt', 'Meta']) {
      expect(bindingFromEvent(press({ key })), key).toBeNull();
    }
  });
});

describe('matching', () => {
  it('ignores case on a letter', () => {
    expect(matches({ key: 'w' }, press({ key: 'W' }))).toBe(true);
    expect(matches({ key: 'W' }, press({ key: 'w' }))).toBe(true);
  });

  it('requires the same modifiers', () => {
    expect(matches({ key: 'w' }, press({ key: 'w', ctrlKey: true }))).toBe(false);
    expect(matches({ key: 'w', ctrl: true }, press({ key: 'w' }))).toBe(false);
    expect(matches({ key: 'w', ctrl: true }, press({ key: 'w', ctrlKey: true }))).toBe(true);
  });

  it('maps a keystroke to its action', () => {
    expect(actionFor(DEFAULT_BINDINGS, press({ key: 'w' }))).toBe('higher');
    expect(actionFor(DEFAULT_BINDINGS, press({ key: 's' }))).toBe('lower');
    expect(actionFor(DEFAULT_BINDINGS, press({ key: '?' }))).toBe('help');
    expect(actionFor(DEFAULT_BINDINGS, press({ key: 'z' }))).toBeNull();
  });
});

describe('never firing while someone types', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('leaves every editable control alone', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      const element = document.createElement(tag);
      document.body.append(element);
      expect(isTyping(element), tag).toBe(true);
    }
  });

  it('leaves a contenteditable alone', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.append(editable);
    // jsdom does not implement isContentEditable, so the ancestor check carries it
    expect(isTyping(editable)).toBe(true);
  });

  it('leaves something nested inside a field alone', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    wrapper.append(inner);
    document.body.append(wrapper);
    expect(isTyping(inner)).toBe(true);
  });

  it('fires everywhere else', () => {
    const button = document.createElement('button');
    document.body.append(button);
    expect(isTyping(button)).toBe(false);
    expect(isTyping(document.body)).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

describe('describing a binding', () => {
  it('reads the way a keyboard looks', () => {
    expect(formatBinding({ key: 'w' })).toBe('W');
    expect(formatBinding({ key: ']' })).toBe(']');
    expect(formatBinding({ key: ' ' })).toBe('Space');
    expect(formatBinding({ key: 'k', ctrl: true })).toBe('Ctrl+K');
    expect(formatBinding({ key: 'Enter', shift: true })).toBe('⇧+Enter');
  });
});

describe('comparing bindings', () => {
  it('treats the same key with the same modifiers as equal', () => {
    expect(bindingsEqual({ key: 'w' }, { key: 'W' })).toBe(true);
    expect(bindingsEqual({ key: 'w' }, { key: 'w', ctrl: true })).toBe(false);
    expect(bindingsEqual({ key: 'w', shift: true }, { key: 'w' })).toBe(false);
  });
});

describe('conflicts', () => {
  it('finds two actions sharing a key', () => {
    const clashing = conflicts({ ...DEFAULT_BINDINGS, lower: { key: 'w' } });
    expect(clashing.sort()).toEqual(['higher', 'lower']);
  });

  it('finds none in the defaults', () => {
    expect(conflicts(DEFAULT_BINDINGS)).toEqual([]);
  });
});

describe('preferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults when nothing is stored', () => {
    expect(loadPreferences()).toEqual({ enabled: true, bindings: DEFAULT_BINDINGS });
  });

  it('round-trips what a trader chose', () => {
    savePreferences({ enabled: false, bindings: { ...DEFAULT_BINDINGS, higher: { key: 'j' } } });
    const loaded = loadPreferences();
    expect(loaded.enabled).toBe(false);
    expect(loaded.bindings.higher).toEqual({ key: 'j' });
  });

  it('keeps the default for one unrecognised action instead of discarding the set', () => {
    localStorage.setItem(
      'qx.hotkeys',
      JSON.stringify({ enabled: true, bindings: { higher: { key: '' }, lower: { key: 'm' } } }),
    );
    const loaded = loadPreferences();
    expect(loaded.bindings.higher).toEqual(DEFAULT_BINDINGS.higher);
    expect(loaded.bindings.lower).toEqual({ key: 'm' });
    expect(loaded.bindings.help).toEqual(DEFAULT_BINDINGS.help);
  });

  it('survives storage holding nonsense', () => {
    localStorage.setItem('qx.hotkeys', 'not json');
    expect(loadPreferences()).toEqual({ enabled: true, bindings: DEFAULT_BINDINGS });
  });
});
