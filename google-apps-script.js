/**
 * WaterOps Google Sheets bridge - copy/paste version.
 *
 * Paste this whole file into Google Apps Script.
 * If your Apps Script is not attached to the Google Sheet, put the Sheet ID
 * between the quotes below. If it is attached to the Sheet, leave it blank.
 */

var SPREADSHEET_ID = '';

var SHEETS = {
  visits: 'Visit Log',
  costEvents: 'Cost Sync Events',
  stockUsed: 'Stock Used',
  costSettings: 'Cost Settings',
  costSnapshots: 'Cost Snapshots',
  costReports: 'Cost Reports',
  technicians: 'Technicians',
  closedLoops: 'Closed Loop Log'
};

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  var action = String(params.action || '');
  var callback = String(params.callback || '');

  if (action === 'costSnapshot') {
    return jsonp_(callback, {
      ok: true,
      snapshot: buildCostSnapshot_()
    });
  }
  if (action === 'technicianList') {
    return jsonp_(callback, {
      ok: true,
      names: buildTechnicianList_()
    });
  }


  return jsonp_(callback, {
    ok: true,
    message: 'WaterOps Google Sheets bridge is running.',
    availableActions: ['costSnapshot', 'technicianList', 'closedLoopVisit POST']
  });
}

function doPost(e) {
  var payload = parsePayload_(e);
  if (!payload) {
    return json_({ ok: false, error: 'No payload received.' });
  }

  if (payload.payloadType === 'costSync') {
    handleCostSync_(payload);
    return json_({
      ok: true,
      payloadType: 'costSync',
      action: payload.action || ''
    });
  }

  if (payload.payloadType === 'closedLoopVisit') {
    appendClosedLoopPayload_(payload);
    return json_({
      ok: true,
      payloadType: 'closedLoopVisit',
      sheet: SHEETS.closedLoops
    });
  }

  appendVisitPayload_(payload);
  return json_({
    ok: true,
    payloadType: payload.payloadType || 'visit'
  });
}

function parsePayload_(e) {
  var raw = '';
  if (e && e.postData && e.postData.contents) {
    raw = e.postData.contents;
  } else if (e && e.parameter && e.parameter.payload) {
    raw = e.parameter.payload;
  }
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (error) {
    return {
      rawPayload: raw,
      parseError: String(error)
    };
  }
}

function handleCostSync_(payload) {
  var data = payload.data || {};
  var action = payload.action || '';

  appendRows_(SHEETS.costEvents, [
    ['receivedAt', 'sentAt', 'deviceId', 'action', 'payloadJson'],
    [new Date(), payload.sentAt || '', payload.deviceId || '', action, JSON.stringify(payload)]
  ]);

  if (action === 'stock_used_added') {
    var txRows = [];
    var transactions = data.transactions || [];
    for (var i = 0; i < transactions.length; i += 1) {
      txRows.push(stockRow_(transactions[i], data.pool, payload));
    }
    if (txRows.length) appendRows_(SHEETS.stockUsed, [stockHeader_()].concat(txRows));
  }

  if (action === 'cost_settings_saved') {
    appendRows_(SHEETS.costSettings, [
      costSettingsHeader_(),
      costSettingsRow_(data.pool || {}, data.settings || {}, payload)
    ]);
  }

  if (action === 'stock_used_cleared') {
    var poolKey = data.pool && data.pool.key ? data.pool.key : '';
    if (poolKey) removeStockRowsForPool_(poolKey);
    appendRows_(SHEETS.costEvents, [
      ['receivedAt', 'sentAt', 'deviceId', 'action', 'payloadJson'],
      [new Date(), payload.sentAt || '', payload.deviceId || '', 'stock_used_cleared_marker', JSON.stringify(data)]
    ]);
  }

  if (action === 'snapshot') {
    appendSnapshot_(data, payload);
  }

  if (action === 'cost_report_generated') {
    var report = data.report || {};
    var pool = report.pool || {};
    var settings = report.settings || {};
    appendRows_(SHEETS.costReports, [
      ['receivedAt', 'sentAt', 'deviceId', 'site', 'poolKey', 'poolName', 'costCentre', 'supervisor', 'jobRef', 'pricedTotal', 'unpricedCount', 'reportJson'],
      [new Date(), payload.sentAt || '', payload.deviceId || '', pool.site || '', pool.key || '', pool.poolName || '', settings.costCentre || '', settings.supervisor || '', settings.jobRef || '', report.pricedTotal || 0, report.unpricedCount || 0, JSON.stringify(data)]
    ]);
  }
}

function appendSnapshot_(data, payload) {
  appendRows_(SHEETS.costSnapshots, [
    ['receivedAt', 'sentAt', 'deviceId', 'capturedAt', 'snapshotJson'],
    [new Date(), payload.sentAt || '', payload.deviceId || '', data.capturedAt || '', JSON.stringify(data)]
  ]);

  var stock = data.stock || {};
  var transactions = stock.transactions || [];
  if (transactions.length) {
    var stockRows = [];
    for (var i = 0; i < transactions.length; i += 1) {
      stockRows.push(stockRow_(transactions[i], null, payload));
    }
    appendRows_(SHEETS.stockUsed, [stockHeader_()].concat(stockRows));
  }

  var settings = data.costSettings || {};
  var settingRows = [];
  for (var poolKey in settings) {
    if (settings.hasOwnProperty(poolKey)) {
      settingRows.push(costSettingsRow_({ key: poolKey }, settings[poolKey], payload));
    }
  }
  if (settingRows.length) {
    appendRows_(SHEETS.costSettings, [costSettingsHeader_()].concat(settingRows));
  }
}

function buildCostSnapshot_() {
  var stockRows = readObjects_(SHEETS.stockUsed);
  var settingsRows = readObjects_(SHEETS.costSettings);
  var transactionMap = {};
  var i;

  for (i = 0; i < stockRows.length; i += 1) {
    var row = stockRows[i];
    var id = row.id || [row.poolKey, row.ts, row.chemical, row.qty].join('-');
    transactionMap[id] = {
      id: id,
      ts: row.ts || '',
      date: row.date || '',
      poolKey: row.poolKey || '',
      poolName: row.poolName || '',
      site: row.site || '',
      chemical: row.chemical || '',
      chemicalLabel: row.chemicalLabel || '',
      source: row.source || '',
      sourceLabel: row.sourceLabel || '',
      qty: numberOrNull_(row.qty),
      unit: row.unit || '',
      unitRate: numberOrNull_(row.unitRate),
      costUnit: row.costUnit || '',
      qtyText: row.qtyText || '',
      note: row.note || '',
      isManualExtra: String(row.isManualExtra || '').toLowerCase() === 'true'
    };
  }

  var costSettings = {};
  for (i = 0; i < settingsRows.length; i += 1) {
    var settingRow = settingsRows[i];
    var settingPoolKey = settingRow.poolKey || '';
    if (!settingPoolKey) continue;
    costSettings[settingPoolKey] = {
      costCentre: settingRow.costCentre || '',
      supervisor: settingRow.supervisor || '',
      jobRef: settingRow.jobRef || '',
      notes: settingRow.notes || '',
      rates: {
        acid: numberOrEmpty_(settingRow.rateAcid),
        chlorine: numberOrEmpty_(settingRow.rateChlorine),
        bicarb: numberOrEmpty_(settingRow.rateBicarb),
        calcium: numberOrEmpty_(settingRow.rateCalcium),
        stabiliser: numberOrEmpty_(settingRow.rateStabiliser),
        salt: numberOrEmpty_(settingRow.rateSalt)
      }
    };
  }

  var transactions = [];
  for (var key in transactionMap) {
    if (transactionMap.hasOwnProperty(key)) transactions.push(transactionMap[key]);
  }

  return {
    stock: {
      transactions: transactions
    },
    costSettings: costSettings,
    capturedAt: new Date().toISOString()
  };
}

function buildTechnicianList_() {
  var sheet = getOrCreateSheet_(SHEETS.technicians);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Name']);
    return [];
  }

  var values = sheet.getDataRange().getValues();
  var names = [];
  var seen = {};
  for (var i = 0; i < values.length; i += 1) {
    var name = String(values[i][0] || '').trim();
    if (!name || name.toLowerCase() === 'name') continue;
    var key = name.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    names.push(name);
  }
  names.sort();
  return names;
}
function appendVisitPayload_(payload) {
  appendRows_(SHEETS.visits, [
    ['receivedAt', 'payloadJson'],
    [new Date(), JSON.stringify(payload)]
  ]);
}

function appendClosedLoopPayload_(payload) {
  var rows = payload.rows || payload.closedLoopRows || [];
  var checks = payload.checks || payload.fieldChecks || [];
  var flaggedCount = payload.flaggedCount;
  var missingCount = payload.missingCount;
  if (flaggedCount === '' || flaggedCount == null) flaggedCount = countClosedLoopStatus_(rows, ['Low', 'High']);
  if (missingCount === '' || missingCount == null) missingCount = countClosedLoopStatus_(rows, ['Missing']);

  appendRows_(SHEETS.closedLoops, [
    closedLoopHeader_(),
    [
      new Date(),
      payload.sentAt || '',
      payload.deviceId || '',
      payload.visitId || '',
      payload.site || '',
      payload.assetName || '',
      payload.system || 'Closed loop',
      payload.technician || '',
      payload.serviceDate || '',
      payload.serviceTime || '',
      payload.nextServiceDays || '',
      closedLoopReading_(rows, 'HHW', 'TDS'),
      closedLoopReading_(rows, 'HHW', 'pH'),
      closedLoopReading_(rows, 'HHW', 'Inhibitor'),
      closedLoopReading_(rows, 'CHW', 'TDS'),
      closedLoopReading_(rows, 'CHW', 'pH'),
      closedLoopReading_(rows, 'CHW', 'Inhibitor'),
      closedLoopCheck_(checks, 'Make-up / pressure'),
      closedLoopCheck_(checks, 'Filter / strainer'),
      closedLoopCheck_(checks, 'Corrosion / debris'),
      closedLoopCheck_(checks, 'Glycol / freeze point'),
      flaggedCount,
      missingCount,
      payload.forecast || closedLoopForecast_(rows),
      payload.notes || '',
      JSON.stringify(rows),
      JSON.stringify(checks),
      JSON.stringify(payload)
    ]
  ]);

  // Keep the raw visit log as a backup as well.
  appendVisitPayload_(payload);
}

function closedLoopHeader_() {
  return [
    'receivedAt', 'sentAt', 'deviceId', 'visitId', 'site', 'systemName', 'system', 'technician',
    'serviceDate', 'serviceTime', 'nextServiceDays',
    'hhwTds', 'hhwPh', 'hhwInhibitor', 'chwTds', 'chwPh', 'chwInhibitor',
    'makeupPressure', 'filterStrainer', 'corrosionDebris', 'glycolFreezePoint',
    'flaggedCount', 'missingCount', 'forecast', 'notes', 'rowsJson', 'checksJson', 'payloadJson'
  ];
}

function closedLoopReading_(rows, loop, parameter) {
  for (var i = 0; i < rows.length; i += 1) {
    var row = rows[i] || {};
    if (String(row.loop || '').toUpperCase() === loop && String(row.parameter || '').toLowerCase() === String(parameter).toLowerCase()) {
      return row.current == null ? '' : row.current;
    }
  }
  return '';
}

function closedLoopCheck_(checks, label) {
  for (var i = 0; i < checks.length; i += 1) {
    var item = checks[i] || {};
    if (String(item.label || '').toLowerCase() === String(label).toLowerCase()) {
      return item.value || '';
    }
  }
  return '';
}

function countClosedLoopStatus_(rows, labels) {
  var count = 0;
  var wanted = {};
  for (var i = 0; i < labels.length; i += 1) wanted[String(labels[i]).toLowerCase()] = true;
  for (var j = 0; j < rows.length; j += 1) {
    var status = String((rows[j] || {}).status || '').toLowerCase();
    if (wanted[status]) count += 1;
  }
  return count;
}

function closedLoopForecast_(rows) {
  var flagged = countClosedLoopStatus_(rows, ['Low', 'High']);
  var missing = countClosedLoopStatus_(rows, ['Missing']);
  if (flagged >= 3) return 'Action';
  if (flagged >= 1) return 'Watch';
  if (missing >= 1) return 'Incomplete';
  return 'Stable';
}

function stockHeader_() {
  return ['receivedAt', 'sentAt', 'deviceId', 'id', 'ts', 'date', 'site', 'poolKey', 'poolName', 'chemical', 'chemicalLabel', 'source', 'sourceLabel', 'qty', 'unit', 'unitRate', 'costUnit', 'qtyText', 'note', 'isManualExtra'];
}

function stockRow_(tx, pool, payload) {
  pool = pool || {};
  return [
    new Date(),
    payload.sentAt || '',
    payload.deviceId || '',
    tx.id || '',
    tx.ts || '',
    tx.date || '',
    tx.site || pool.site || '',
    tx.poolKey || pool.key || '',
    tx.poolName || pool.poolName || '',
    tx.chemical || '',
    tx.chemicalLabel || '',
    tx.source || '',
    tx.sourceLabel || '',
    tx.qty || 0,
    tx.unit || '',
    tx.unitRate == null ? '' : tx.unitRate,
    tx.costUnit || '',
    tx.qtyText || '',
    tx.note || '',
    !!tx.isManualExtra
  ];
}

function costSettingsHeader_() {
  return ['receivedAt', 'sentAt', 'deviceId', 'poolKey', 'site', 'poolName', 'costCentre', 'supervisor', 'jobRef', 'notes', 'rateAcid', 'rateChlorine', 'rateBicarb', 'rateCalcium', 'rateStabiliser', 'rateSalt'];
}

function costSettingsRow_(pool, settings, payload) {
  var rates = settings.rates || {};
  return [
    new Date(),
    payload.sentAt || '',
    payload.deviceId || '',
    pool.key || '',
    pool.site || '',
    pool.poolName || '',
    settings.costCentre || '',
    settings.supervisor || '',
    settings.jobRef || '',
    settings.notes || '',
    rates.acid == null ? '' : rates.acid,
    rates.chlorine == null ? '' : rates.chlorine,
    rates.bicarb == null ? '' : rates.bicarb,
    rates.calcium == null ? '' : rates.calcium,
    rates.stabiliser == null ? '' : rates.stabiliser,
    rates.salt == null ? '' : rates.salt
  ];
}

function appendRows_(sheetName, rowsWithHeader) {
  var sheet = getOrCreateSheet_(sheetName);
  var header = rowsWithHeader[0];
  var rows = rowsWithHeader.slice(1);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
  }

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
}

function readObjects_(sheetName) {
  var sheet = getOrCreateSheet_(sheetName);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = [];
  var objects = [];
  var i;
  var j;

  for (i = 0; i < values[0].length; i += 1) {
    headers.push(String(values[0][i]));
  }

  for (i = 1; i < values.length; i += 1) {
    var item = {};
    for (j = 0; j < headers.length; j += 1) {
      item[headers[j]] = values[i][j];
    }
    objects.push(item);
  }

  return objects;
}

function removeStockRowsForPool_(poolKey) {
  var sheet = getOrCreateSheet_(SHEETS.stockUsed);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return;

  var headers = [];
  for (var i = 0; i < values[0].length; i += 1) {
    headers.push(String(values[0][i]));
  }

  var poolIndex = headers.indexOf('poolKey');
  if (poolIndex < 0) return;

  for (var row = values.length; row >= 2; row -= 1) {
    if (String(values[row - 1][poolIndex]) === String(poolKey)) {
      sheet.deleteRow(row);
    }
  }
}

function getOrCreateSheet_(name) {
  var spreadsheet = getSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  return sheet;
}

function getSpreadsheet_() {
  if (SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function json_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonp_(callback, value) {
  var body = callback
    ? callback + '(' + JSON.stringify(value) + ');'
    : JSON.stringify(value);

  return ContentService
    .createTextOutput(body)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function numberOrNull_(value) {
  var number = Number(value);
  return isFinite(number) ? number : null;
}

function numberOrEmpty_(value) {
  var number = Number(value);
  return isFinite(number) ? number : '';
}
