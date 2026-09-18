import assert from 'node:assert/strict'
import test from 'node:test'
import { get } from 'svelte/store'
import { format_message, locale, resolve_locale, set_locale, t, translate, ui_message } from '../src/i18n.ts'
import { zh } from '../src/messages.ts'

test('saved language wins; browser Chinese variants and unsupported languages fall back predictably', () => {
  assert.equal(resolve_locale('en', 'zh-CN'), 'en')
  assert.equal(resolve_locale('zh', 'en-US'), 'zh')
  for (const language of ['zh', 'zh-CN', 'zh-TW', 'ZH-Hant']) assert.equal(resolve_locale(null, language), 'zh')
  for (const language of ['en-GB', 'fr', '', 'zho']) assert.equal(resolve_locale('invalid', language), 'en')
})

test('messages interpolate zero, preserve unknown placeholders and do not recursively translate user labels', () => {
  assert.equal(translate('zh', 'Studio lighting'), '影棚布光')
  assert.equal(translate('en', 'Studio lighting'), 'Studio lighting')
  assert.equal(translate('zh', 'Volume layers ({count})', { count: 0 }), '体数据图层（0）')
  assert.equal(translate('zh', '{name} removed', { name: 'Balanced' }), '已移除 Balanced')
  assert.equal(translate('zh', '{unprovided}'), '{unprovided}')
  assert.equal(translate('zh', 'Unknown backend detail: 42'), 'Unknown backend detail: 42')
  assert.equal(translate('zh', 'constructor'), 'constructor')
})

test('Chinese messages retain the same parameter names as their English sources', () => {
  const parameters = (value: string) => [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort()
  for (const [english, chinese] of Object.entries(zh)) assert.deepEqual(parameters(chinese), parameters(english), english)
})

test('locale updates existing message templates and the store without changing raw scientific labels', () => {
  const message = ui_message('{count} volume layer(s) loaded', { count: 2 })
  const original = get(locale)
  try {
    set_locale('zh')
    assert.equal(get(t)('Balanced'), '均衡')
    assert.equal(format_message(get(locale), message), '已载入 2 个体数据图层')
    assert.equal(format_message(get(locale), 'Balanced'), 'Balanced')
    set_locale('en')
    assert.equal(format_message(get(locale), message), '2 volume layer(s) loaded')
  } finally { set_locale(original) }
})
