'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript, plain } = require('./helpers/load-apps-script');

const TEMPLATE = {
  subject: 'Notice {{Reference}}',
  plainBody: 'Hola {{First Name}}, referencia {{Reference}}.',
  htmlBody: '<p>Hola {{First Name}}, referencia <b>{{ Reference }}</b>.</p>',
};

function rowValues(overrides = {}) {
  return {
    'Email Address': 'alpha@example.test',
    'First Name': 'Alpha',
    Reference: 'REF-1',
    'File Attachments': '',
    'Mail Merge Status': '',
    ...overrides,
  };
}

test('AC-01: dos filas distintas producen asuntos y cuerpos distintos sin fuga entre filas', () => {
  const ctx = loadAppsScript();
  const alpha = ctx.renderTemplate_(TEMPLATE, rowValues());
  const beta = ctx.renderTemplate_(
    TEMPLATE,
    rowValues({ 'Email Address': 'beta@example.test', 'First Name': 'Beta', Reference: 'REF-2' })
  );
  assert.equal(alpha.ok, true);
  assert.equal(beta.ok, true);
  assert.equal(alpha.subject, 'Notice REF-1');
  assert.equal(beta.subject, 'Notice REF-2');
  assert.equal(alpha.plainBody, 'Hola Alpha, referencia REF-1.');
  assert.equal(beta.htmlBody, '<p>Hola Beta, referencia <b>REF-2</b>.</p>');
  assert.notEqual(alpha.htmlBody, beta.htmlBody);
  assert.notEqual(alpha.plainBody, beta.plainBody);
  for (const part of [alpha.subject, alpha.plainBody, alpha.htmlBody]) {
    assert.ok(!part.includes('Beta') && !part.includes('REF-2'));
  }
  for (const part of [beta.subject, beta.plainBody, beta.htmlBody]) {
    assert.ok(!part.includes('Alpha') && !part.includes('REF-1'));
  }
});

test('AC-02: el HTML escapa el valor, el asunto no tiene CR/LF y el texto plano conserva el valor crudo', () => {
  const ctx = loadAppsScript();
  const dangerous = '<script>alert("x")</script> & \'q\'\r\nsegunda línea';
  const template = {
    subject: 'Aviso {{First Name}}',
    plainBody: 'Hola {{First Name}}',
    htmlBody: '<p>Hola {{First Name}}</p>',
  };
  const result = ctx.renderTemplate_(template, rowValues({ 'First Name': dangerous }));
  assert.equal(result.ok, true);
  assert.ok(result.htmlBody.includes('&lt;script&gt;'));
  assert.ok(result.htmlBody.includes('&amp;'));
  assert.ok(result.htmlBody.includes('&quot;'));
  assert.ok(result.htmlBody.includes('&#39;'));
  assert.ok(!result.htmlBody.includes('<script>'));
  assert.ok(!/[\r\n]/.test(result.subject));
  assert.equal(result.subject, 'Aviso <script>alert("x")</script> & \'q\' segunda línea');
  assert.equal(result.plainBody, 'Hola ' + dangerous);
});

test('AC-02: escapeHtml_ y sanitizeHeaderValue_ tratan cada carácter especial', () => {
  const ctx = loadAppsScript();
  assert.equal(ctx.escapeHtml_('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(ctx.sanitizeHeaderValue_('  uno\r\n\tdos\nTres  '), 'uno dos Tres');
});

test('AC-03: un marcador que no es un encabezado bloquea la fila y no se reemplaza por vacío', () => {
  const ctx = loadAppsScript();
  const template = {
    subject: 'Notice {{Reference}}',
    plainBody: 'Hola {{Not a column}}',
    htmlBody: '<p>Hola {{Not a column}}</p>',
  };
  const result = ctx.renderTemplate_(template, rowValues());
  assert.equal(result.ok, false);
  assert.deepEqual(plain(result.errors), ['Marcador desconocido: {{Not a column}}']);
  for (const part of [result.subject, result.plainBody, result.htmlBody]) {
    assert.ok(part === null || part === undefined || part.includes('{{Not a column}}'));
    assert.notEqual(part, 'Hola ');
  }
});

test('AC-04: un marcador con valor vacío o solo espacios bloquea la fila', () => {
  const ctx = loadAppsScript();
  for (const empty of ['', '   ']) {
    const result = ctx.renderTemplate_(TEMPLATE, rowValues({ 'First Name': empty }));
    assert.equal(result.ok, false);
    assert.deepEqual(plain(result.errors), ['El campo "First Name" está vacío']);
  }
});

test('R-03: extractTokens_ devuelve nombres únicos y con html: true decodifica entidades', () => {
  const ctx = loadAppsScript();
  assert.deepEqual(plain(ctx.extractTokens_('{{ A }} {{B}} {{A}}', { html: false })), ['A', 'B']);
  assert.deepEqual(
    plain(ctx.extractTokens_('<p>{{R&amp;D}} {{First&nbsp;Name}} {{First Name}}</p>', { html: true })),
    ['R&D', 'First Name']
  );
  // Sin html, las entidades se conservan tal cual (el asunto y el texto plano no son HTML).
  assert.deepEqual(plain(ctx.extractTokens_('{{R&amp;D}}', { html: false })), ['R&amp;D']);
});

test('R-03: renderTemplate_ resuelve en el HTML un marcador codificado como entidad', () => {
  const ctx = loadAppsScript();
  const template = { subject: 'Área {{R&D}}', plainBody: 'Área {{R&D}}', htmlBody: '<p>Área {{R&amp;D}} {{First&nbsp;Name}}</p>' };
  const result = ctx.renderTemplate_(template, rowValues({ 'R&D': 'Investigación & Desarrollo' }));
  assert.equal(result.ok, true);
  assert.equal(result.subject, 'Área Investigación & Desarrollo');
  assert.equal(result.htmlBody, '<p>Área Investigación &amp; Desarrollo Alpha</p>');
});

test('R-03: un valor con $& o $1 se inserta literal', () => {
  const ctx = loadAppsScript();
  const value = 'Total $& $1 $$ $`';
  const result = ctx.renderTemplate_(TEMPLATE, rowValues({ Reference: value }));
  assert.equal(result.ok, true);
  assert.equal(result.subject, 'Notice ' + value);
  assert.equal(result.plainBody, 'Hola Alpha, referencia ' + value + '.');
  // En el HTML el `&` de `$&` se escapa; el resto se inserta literal.
  assert.ok(result.htmlBody.includes('<b>Total $&amp; $1 $$ $`</b>'));
});

test('R-03: un valor que contiene {{Otra}} no se reinterpreta y findUnresolvedTokens_ lo detecta', () => {
  const ctx = loadAppsScript();
  const result = ctx.renderTemplate_(TEMPLATE, rowValues({ 'First Name': '{{Reference}}' }));
  assert.equal(result.ok, true);
  assert.equal(result.plainBody, 'Hola {{Reference}}, referencia REF-1.');
  assert.equal(ctx.findUnresolvedTokens_(result.plainBody), true);
  assert.equal(ctx.findUnresolvedTokens_(result.htmlBody), true);
  assert.equal(ctx.findUnresolvedTokens_(result.subject), false);
});

test('R-03: un marcador cortado por etiquetas HTML queda detectado como no resuelto', () => {
  const ctx = loadAppsScript();
  const tagged = { subject: 'Notice', plainBody: 'Hola', htmlBody: '<p>Hola {{First <b>Name</b>}}</p>' };
  const taggedResult = ctx.renderTemplate_(tagged, rowValues());
  assert.equal(taggedResult.ok, false);
  assert.ok(taggedResult.errors.some((e) => e.startsWith('Marcador desconocido: {{First <b>Name</b>}}')));
  assert.equal(ctx.findUnresolvedTokens_(tagged.htmlBody), true);

  const split = { subject: 'Notice', plainBody: 'Hola', htmlBody: '<p>Hola {<b>{</b>First Name}}</p>' };
  const splitResult = ctx.renderTemplate_(split, rowValues());
  assert.equal(splitResult.ok, true);
  assert.equal(ctx.findUnresolvedTokens_(splitResult.htmlBody), true);
  assert.equal(ctx.findUnresolvedTokens_('<p>Hola Alpha</p>'), false);
});

test('R-03: mapInlineImages_ empareja cid con la imagen inline por el alt', () => {
  const ctx = loadAppsScript();
  const blob = { fakeBlob: 'logo' };
  const result = ctx.mapInlineImages_('<p><img src="cid:logo" alt="logo.png"></p>', [{ name: 'logo.png', blob }]);
  assert.equal(result.ok, true);
  assert.deepEqual(plain(result.errors), []);
  assert.deepEqual(Object.keys(result.inlineImages), ['logo']);
  assert.equal(result.inlineImages.logo, blob);

  const none = ctx.mapInlineImages_('<p>Sin imágenes</p>', [{ name: 'logo.png', blob }]);
  assert.equal(none.ok, true);
  assert.deepEqual(Object.keys(none.inlineImages), []);
});

test('R-03: mapInlineImages_ falla cerrado con un cid sin alt o con un alt sin coincidencia', () => {
  const ctx = loadAppsScript();
  const images = [{ name: 'logo.png', blob: { fakeBlob: 'logo' } }];
  const withoutAlt = ctx.mapInlineImages_('<img src="cid:logo">', images);
  assert.equal(withoutAlt.ok, false);
  assert.ok(withoutAlt.errors.length > 0);

  const noMatch = ctx.mapInlineImages_('<img alt="otra.png" src="cid:logo">', images);
  assert.equal(noMatch.ok, false);
  assert.ok(noMatch.errors.length > 0);

  const noImages = ctx.mapInlineImages_('<img src="cid:logo" alt="logo.png">', []);
  assert.equal(noImages.ok, false);

  // Un `>` dentro de un atributo entre comillas no oculta el `cid` que sigue.
  const quotedGt = ctx.mapInlineImages_('<img alt="a>b" src="cid:logo">', images);
  assert.equal(quotedGt.ok, false);
  assert.ok(quotedGt.errors.length > 0);
});

test('D-21: utf8ByteLength_ cuenta bytes UTF-8 por code point', () => {
  const ctx = loadAppsScript();
  assert.equal(ctx.utf8ByteLength_(''), 0);
  assert.equal(ctx.utf8ByteLength_('abc'), 3);
  assert.equal(ctx.utf8ByteLength_('á'), 2);
  assert.equal(ctx.utf8ByteLength_('€'), 3);
  assert.equal(ctx.utf8ByteLength_('😀'), 4);
  const mixed = 'Hola á € 😀 fin';
  assert.equal(ctx.utf8ByteLength_(mixed), Buffer.byteLength(mixed, 'utf8'));
});
