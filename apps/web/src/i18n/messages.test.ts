import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import { routing } from './routing';

/**
 * The catalogues, checked against each other.
 *
 * A locale that is missing a key does not fail at build time: it fails in
 * front of whoever is reading that page, in production, in a language they
 * did not ask for. And a key nobody removed from the other catalogue is how
 * a translation silently keeps a sentence the product no longer says.
 *
 * Placeholders are compared too. `{count}` renamed on one side only renders
 * the raw brace text to the reader, which is worse than the untranslated
 * sentence would have been.
 */

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [inner, text] of flatten(value, path)) out.set(inner, text);
  }
  return out;
}

/**
 * The values a caller has to pass: `{count}`, `{count, plural, …}`, `<link>`.
 *
 * Only arguments at the top level of the message are collected. Inside a
 * plural, `{vide}` is the text of a branch, not an argument, and a regular
 * expression that cannot tell the two apart reports every branch as a missing
 * value — which is how this test first failed on a correct pair of messages.
 */
function placeholders(message: string): string[] {
  const names = new Set<string>();
  let depth = 0;
  for (let index = 0; index < message.length; index += 1) {
    const character = message[index];
    if (character === '}') {
      depth -= 1;
      continue;
    }
    if (character !== '{') continue;
    if (depth === 0) {
      const name = /^\s*([a-zA-Z0-9_]+)\s*[,}]/.exec(message.slice(index + 1));
      if (name) names.add(name[1] as string);
    }
    depth += 1;
  }
  for (const match of message.matchAll(/<([a-zA-Z0-9_]+)>/g)) names.add(`<${match[1] as string}>`);
  return [...names].sort();
}

const french = flatten(fr as Tree);
const english = flatten(en as Tree);

describe('the message catalogues', () => {
  it('covers every declared locale', () => {
    expect([...routing.locales].sort()).toEqual(['en', 'fr']);
  });

  it('says the same things in both languages', () => {
    expect([...english.keys()].sort()).toEqual([...french.keys()].sort());
  });

  it('keeps the same placeholders on both sides', () => {
    const differences: string[] = [];
    for (const [key, source] of french) {
      const target = english.get(key);
      if (target === undefined) continue;
      const left = placeholders(source).join(', ');
      const right = placeholders(target).join(', ');
      if (left !== right) differences.push(`${key}: fr(${left}) ≠ en(${right})`);
    }
    expect(differences).toEqual([]);
  });

  it('has no empty message', () => {
    const empty = [...french, ...english]
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it('leaves no French in the English catalogue', () => {
    // Not a spell-check: a handful of words that only appear when a key was
    // copied across and never translated.
    const tell = /\b(l’arbre|les|une|aucune|vous|votre|personnes|d’une)\b/i;
    const suspect = [...english]
      .filter(([, value]) => tell.test(value))
      .map(([key, value]) => `${key}: ${value}`);
    expect(suspect).toEqual([]);
  });
});
