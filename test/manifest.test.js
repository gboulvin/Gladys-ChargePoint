// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest, but it cannot know which handlers
// the code registers: these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { ACTIONS } from '../src/actions.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { SCENE_TRIGGERS } from '../src/events.js';
import { WIDGETS } from '../src/widgets.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { LANGUAGES } from '../src/i18n.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

/** Every multi-language object of the manifest, with its path. */
function multiLanguageTexts(node, path = 'manifest', found = []) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => multiLanguageTexts(item, `${path}[${index}]`, found));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (['label', 'description', 'placeholder'].includes(key) && typeof value === 'object') {
        found.push([`${path}.${key}`, value]);
      } else {
        multiLanguageTexts(value, `${path}.${key}`, found);
      }
    }
  }
  return found;
}

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 50);
  for (const [path, text] of texts) {
    for (const lang of LANGUAGES) {
      assert.ok(typeof text[lang] === 'string' && text[lang].length > 0, `${path}.${lang}`);
    }
  }
});

test('the documentation exists in the four languages', async () => {
  for (const lang of LANGUAGES) {
    await access(new URL(`../docs/${lang}.md`, import.meta.url));
  }
});

test('the integration is declared cloud-only', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(ACTIONS).sort());
});

test('every scene_actions key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(SCENE_TRIGGERS).sort());
});

test('every widgets key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
  for (const widget of Object.values(WIDGETS)) {
    assert.equal(typeof widget.get, 'function');
  }
});

test('categories, scene and widget fields require the right Gladys version', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]), 'scenes and widgets need Gladys 5.1.0');
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
});

test('credentials are secret fields', () => {
  for (const key of ['password', 'coulomb_token']) {
    assert.equal(manifest.config_schema.find((f) => f.key === key).type, 'secret');
  }
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}"`);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('field placeholders are multi-language objects', () => {
  for (const field of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}"`);
    assert.ok(field.placeholder.en);
  }
});

test('scene action timeouts leave room for the ChargePoint confirmation', () => {
  for (const key of ['start_charging', 'stop_charging']) {
    const action = manifest.scene_actions.find((a) => a.key === key);
    assert.ok(action.timeout_seconds >= 75, `${key}: 20 acknowledgements 3 s apart`);
  }
});
