'use strict';

// Fixture sintético de `docs/ACCEPTANCE.md`. Nunca contiene datos reales:
// direcciones `example.test`, IDs de Drive inventados y blobs como objetos
// planos identificables. Cada llamada a `createCampaignFixture()` devuelve un
// estado nuevo, que los falsos de `tests/helpers/fakes.js` mutan.

const CAMPAIGN_SHEET_ID = 101;
const LOG_SHEET_ID = 202;
const DRAFT_ID = 'draft-001';
const USER_EMAIL = 'operator@example.test';
const ALIAS_EMAIL = 'alias@example.test';

const HEADER_ROW = [
  'Email Address',
  'First Name',
  'Reference',
  'File Attachments',
  'Fecha',
  'Campaña',
  'Resultado',
  'Detalle',
];

// IDs sintéticos con el formato de Drive (20 caracteres o más).
const DRIVE_IDS = {
  PDF_ALPHA: 'fakePdfAlpha00000000001',
  PDF_BETA: 'fakePdfBeta000000000002',
  DOC_ALPHA: 'fakeDocAlpha00000000003',
  MISSING: 'fakeMissingFile00000009',
};

function fileLink(id) {
  return 'https://drive.google.com/file/d/' + id + '/view?usp=sharing';
}

function openLink(id) {
  return 'https://drive.google.com/open?id=' + id;
}

function docLink(id) {
  return 'https://docs.google.com/document/d/' + id + '/edit';
}

// Arma una fila en el orden de `HEADER_ROW` a partir de un objeto por encabezado.
function buildRow(valuesByHeader = {}) {
  return HEADER_ROW.map((header) => {
    const value = valuesByHeader[header];
    return value === undefined || value === null ? '' : String(value);
  });
}

function createCampaignFixture() {
  const values = [
    HEADER_ROW.slice(),
    buildRow({
      'Email Address': 'alpha@example.test',
      'First Name': 'Alpha',
      Reference: 'REF-001',
      'File Attachments': fileLink(DRIVE_IDS.PDF_ALPHA) + ', ' + docLink(DRIVE_IDS.DOC_ALPHA),
    }),
    buildRow({
      'Email Address': 'beta@example.test',
      'First Name': 'Beta',
      Reference: 'REF-002',
      'File Attachments': openLink(DRIVE_IDS.PDF_BETA),
    }),
    buildRow({
      'Email Address': 'gamma@example.test',
      'First Name': 'Gamma',
      Reference: 'REF-003',
    }),
  ];

  return {
    campaignSheetId: CAMPAIGN_SHEET_ID,
    sheets: [
      {
        id: CAMPAIGN_SHEET_ID,
        name: 'Recipients',
        values: values,
        hiddenByUser: values.map(() => false),
        hiddenByFilter: values.map(() => false),
      },
      {
        id: LOG_SHEET_ID,
        name: 'Registro Mail Merge',
        values: [['Fecha', 'Campaña', 'Pestaña', 'Fila', 'Destinatario', 'Resultado', 'Detalle']],
        hiddenByUser: [false],
        hiddenByFilter: [false],
      },
    ],
    gmail: {
      aliases: [ALIAS_EMAIL],
      drafts: [
        {
          id: DRAFT_ID,
          subject: 'Notice {{Reference}}',
          date: '2026-11-01T10:00:00.000Z',
          plainBody: 'Hello {{First Name}}, this is notice {{Reference}}.',
          htmlBody:
            '<p>Hello {{First Name}}, this is notice <b>{{Reference}}</b>.</p>' +
            '<img src="cid:logo" alt="logo.png">',
          attachments: [
            {
              name: 'common-terms.pdf',
              size: 3000,
              mimeType: 'application/pdf',
              blob: { fakeBlob: 'pdf-common' },
            },
          ],
          inlineImages: [{ name: 'logo.png', blob: { fakeBlob: 'img-logo' } }],
        },
      ],
    },
    drive: {
      files: {
        [DRIVE_IDS.PDF_ALPHA]: {
          id: DRIVE_IDS.PDF_ALPHA,
          name: 'alpha-notice.pdf',
          mimeType: 'application/pdf',
          size: 1000,
          trashed: false,
          noAccess: false,
          blob: { fakeBlob: 'pdf-alpha' },
        },
        [DRIVE_IDS.PDF_BETA]: {
          id: DRIVE_IDS.PDF_BETA,
          name: 'beta-notice.pdf',
          mimeType: 'application/pdf',
          size: 2000,
          trashed: false,
          noAccess: false,
          blob: { fakeBlob: 'pdf-beta' },
        },
        // Documento nativo: Drive informa tamaño 0; el tamaño real se conoce al
        // exportarlo a PDF (`exportSize`, `exportBlob`).
        [DRIVE_IDS.DOC_ALPHA]: {
          id: DRIVE_IDS.DOC_ALPHA,
          name: 'Alpha Letter',
          mimeType: 'application/vnd.google-apps.document',
          size: 0,
          trashed: false,
          noAccess: false,
          exportSize: 1500,
          exportBlob: { fakeBlob: 'doc-alpha-pdf' },
        },
      },
    },
    account: { userEmail: USER_EMAIL },
    quota: 100,
    config: { sheetId: CAMPAIGN_SHEET_ID, draftId: DRAFT_ID, from: USER_EMAIL, replyTo: '' },
  };
}

module.exports = {
  createCampaignFixture,
  buildRow,
  fileLink,
  openLink,
  docLink,
  HEADER_ROW,
  DRIVE_IDS,
  CAMPAIGN_SHEET_ID,
  LOG_SHEET_ID,
  DRAFT_ID,
  USER_EMAIL,
  ALIAS_EMAIL,
};
