/**
 * Lógica pura de plantillas: marcadores `{{Encabezado}}`, escape de HTML,
 * saneamiento del asunto, emparejamiento de imágenes inline y tamaño del
 * cuerpo. No accede a servicios de Google.
 */

// Marcador `{{ Nombre }}`. El nombre no puede contener llaves; los espacios
// alrededor se ignoran. Se crea una expresión nueva en cada uso para no
// compartir `lastIndex` entre llamadas.
function tokenPattern_() {
  return /{{\s*([^{}]+?)\s*}}/g;
}

/**
 * Escapa un valor para insertarlo como texto dentro del HTML (R-03, AC-02).
 */
function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanea un valor de encabezado de correo (asunto): cualquier secuencia de
 * CR, LF o tabulaciones pasa a un espacio y se recorta el resultado (AC-02).
 */
function sanitizeHeaderValue_(s) {
  return String(s).replace(/[\r\n\t]+/g, ' ').trim();
}

// Decodifica las entidades que Gmail usa al codificar el nombre de un
// marcador dentro del HTML (por ejemplo `R&amp;D`). Una sola pasada, para no
// decodificar dos veces (`&amp;lt;` queda como `&lt;`). `&nbsp;` y U+00A0
// pasan a un espacio común.
function decodeHtmlEntities_(s) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
  return String(s)
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, function (match, name) {
      return entities[name];
    })
    .replace(/\u00A0/g, ' ');
}

// Nombre del marcador tal como se compara con los encabezados.
function tokenName_(raw, isHtml) {
  return isHtml ? decodeHtmlEntities_(raw).trim() : raw;
}

/**
 * Devuelve los nombres únicos de los marcadores del texto, en orden de
 * aparición. Con `html: true` el nombre se decodifica de entidades HTML
 * antes de devolverlo, para compararlo con los encabezados.
 */
function extractTokens_(text, options) {
  const isHtml = Boolean(options && options.html);
  const names = [];
  const pattern = tokenPattern_();
  let match;
  while ((match = pattern.exec(String(text || ''))) !== null) {
    const name = tokenName_(match[1], isHtml);
    if (names.indexOf(name) === -1) {
      names.push(name);
    }
  }
  return names;
}

// Sustituye los marcadores en una sola pasada con una función de reemplazo:
// el `$` del valor nunca se interpreta y un valor que contiene `{{Otra}}` no
// se vuelve a procesar. `format` adapta el valor al contexto (HTML, texto).
function substituteTokens_(text, rowValuesByHeader, isHtml, format) {
  return String(text || '').replace(tokenPattern_(), function (match, raw) {
    const value = rowValuesByHeader[tokenName_(raw, isHtml)];
    return format(value === null || value === undefined ? '' : String(value));
  });
}

/**
 * Renderiza `{ subject, plainBody, htmlBody }` con los valores de una fila
 * (`{ [encabezado]: valor mostrado }`).
 *
 * Devuelve `{ ok, subject, plainBody, htmlBody, errors }`. Cada marcador que
 * no es un encabezado (`Marcador desconocido: {{X}}`, AC-03) o cuyo valor
 * recortado es vacío (`El campo "X" está vacío`, AC-04) es un error; con
 * errores no se renderiza nada (los textos quedan en `null`), nunca se
 * reemplaza un marcador por vacío. Sin errores: el asunto pasa por
 * `sanitizeHeaderValue_`, el texto plano lleva el valor crudo y el HTML el
 * valor escapado con `escapeHtml_`.
 */
function renderTemplate_(template, rowValuesByHeader) {
  const values = rowValuesByHeader || {};
  const names = [];
  [
    extractTokens_(template.subject, { html: false }),
    extractTokens_(template.plainBody, { html: false }),
    extractTokens_(template.htmlBody, { html: true }),
  ].forEach(function (list) {
    list.forEach(function (name) {
      if (names.indexOf(name) === -1) {
        names.push(name);
      }
    });
  });

  const errors = [];
  names.forEach(function (name) {
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      errors.push('Marcador desconocido: {{' + name + '}}');
      return;
    }
    const value = values[name];
    if (value === null || value === undefined || String(value).trim() === '') {
      errors.push('El campo "' + name + '" está vacío');
    }
  });

  if (errors.length > 0) {
    return { ok: false, subject: null, plainBody: null, htmlBody: null, errors: errors };
  }

  const identity = function (value) {
    return value;
  };
  return {
    ok: true,
    subject: sanitizeHeaderValue_(substituteTokens_(template.subject, values, false, identity)),
    plainBody: substituteTokens_(template.plainBody, values, false, identity),
    htmlBody: substituteTokens_(template.htmlBody, values, true, escapeHtml_),
    errors: [],
  };
}

/**
 * `true` si el texto renderizado todavía contiene `{{` o `}}`: un marcador
 * cortado por etiquetas HTML o un valor que traía otro marcador. Bloquea la
 * fila.
 */
function findUnresolvedTokens_(text) {
  const s = String(text || '');
  return s.indexOf('{{') !== -1 || s.indexOf('}}') !== -1;
}

// Valor de un atributo de una etiqueta HTML (con comillas dobles, simples o
// sin comillas), o `null` si no está.
function htmlAttribute_(tag, name) {
  const pattern = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i');
  const match = pattern.exec(tag);
  if (!match) {
    return null;
  }
  const value = match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[3];
  return decodeHtmlEntities_(value);
}

/**
 * Empareja cada `src="cid:X"` del HTML con una imagen inline del borrador
 * (`[{ name, blob }]`) por el atributo `alt` contra el nombre de la imagen,
 * porque `GmailAttachment` no expone el Content-ID.
 *
 * Devuelve `{ ok, inlineImages: { [cid]: blob }, errors }`. Falla cerrado: un
 * `cid` sin `alt`, con un `alt` que no coincide con ninguna imagen (o con
 * varias del mismo nombre) o un `cid` emparejado con imágenes distintas es
 * error. El comportamiento real de Gmail queda PENDING LIVE VALIDATION.
 */
function mapInlineImages_(htmlBody, inlineImages) {
  const images = inlineImages || [];
  const result = {};
  const errors = [];
  // Una etiqueta termina en el primer `>` que no está dentro de un valor
  // entre comillas: un `>` en un atributo (`alt="a>b"`) no corta la etiqueta
  // ni hace que se pierda el `src="cid:…"` que sigue.
  const tagPattern = /<[a-z](?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  let match;
  while ((match = tagPattern.exec(String(htmlBody || ''))) !== null) {
    const src = htmlAttribute_(match[0], 'src');
    if (src === null || !/^cid:/i.test(src.trim())) {
      continue;
    }
    const cid = src.trim().slice(4);
    const alt = htmlAttribute_(match[0], 'alt');
    if (alt === null || alt.trim() === '') {
      errors.push('La imagen insertada "cid:' + cid + '" no tiene texto alternativo (alt) para identificarla');
      continue;
    }
    const candidates = images.filter(function (image) {
      return image.name === alt;
    });
    if (candidates.length !== 1) {
      errors.push(
        'La imagen insertada "cid:' + cid + '" no coincide con ' +
          (candidates.length === 0 ? 'ninguna imagen' : 'una única imagen') + ' del borrador'
      );
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(result, cid) && result[cid] !== candidates[0].blob) {
      errors.push('La imagen insertada "cid:' + cid + '" corresponde a más de una imagen del borrador');
      continue;
    }
    result[cid] = candidates[0].blob;
  }
  return { ok: errors.length === 0, inlineImages: result, errors: errors };
}

/**
 * Cantidad de bytes UTF-8 del texto, en JavaScript puro (sin `Utilities` ni
 * `Buffer`) para que funcione igual en Apps Script y en Node (D-21). Recorre
 * code points: un par sustituto cuenta 4 bytes; un sustituto suelto cuenta 3
 * (se codifica como U+FFFD).
 */
function utf8ByteLength_(s) {
  let bytes = 0;
  for (const ch of String(s || '')) {
    const code = ch.codePointAt(0);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code < 0x10000) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }
  return bytes;
}
