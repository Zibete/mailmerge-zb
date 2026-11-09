'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadAppsScript, getConst } = require('./helpers/load-apps-script');

const SRC_DIR = path.join(__dirname, '..', 'src');

const APPROVED_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.currentonly',
  'https://www.googleapis.com/auth/script.container.ui',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/script.send_mail',
  'https://www.googleapis.com/auth/userinfo.email',
];

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'appsscript.json'), 'utf8'));
}

test('AC-28: el manifest usa el runtime V8', () => {
  assert.equal(readManifest().runtimeVersion, 'V8');
});

test('AC-28: oauthScopes es exactamente la lista aprobada', () => {
  const scopes = readManifest().oauthScopes;
  assert.ok(Array.isArray(scopes));
  assert.deepEqual([...scopes].sort(), [...APPROVED_SCOPES].sort());
});

test('AC-28: el manifest no declara webapp, executionApi ni dependencies', () => {
  const manifest = readManifest();
  assert.equal('webapp' in manifest, false);
  assert.equal('executionApi' in manifest, false);
  assert.equal('dependencies' in manifest, false);
});

test('AC-28: ningún archivo de src usa UrlFetchApp, ScriptApp.newTrigger ni setSharing', () => {
  const files = fs.readdirSync(SRC_DIR).filter((name) => name.endsWith('.js') || name.endsWith('.html'));
  assert.ok(files.length > 0);
  for (const name of files) {
    const code = fs.readFileSync(path.join(SRC_DIR, name), 'utf8');
    for (const forbidden of ['UrlFetchApp', 'ScriptApp.newTrigger', 'setSharing']) {
      assert.equal(code.includes(forbidden), false, `${name} contiene ${forbidden}`);
    }
  }
});

test('D-01 (AC-28): constantes literales de compatibilidad', () => {
  const ctx = loadAppsScript();
  assert.equal(getConst(ctx, 'HEADERS.EMAIL'), 'Email Address');
  assert.equal(getConst(ctx, 'STATUS.SENDING'), 'ENVIANDO');
  assert.equal(getConst(ctx, 'STATUS.REVIEW'), 'REVISAR');
  assert.equal(getConst(ctx, 'TEST_SUBJECT_PREFIX'), '[PRUEBA] ');
});
