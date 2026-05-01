/**
 * WaterOps Google Sheets bridge - copy/paste version.
 *
 * Paste this whole file into Google Apps Script.
 * If your Apps Script is not attached to the Google Sheet, put the Sheet ID
 * between the quotes below. If it is attached to the Sheet, leave it blank.
 *
 * BlueRiiot needs UrlFetchApp permission. In Apps Script, enable the manifest
 * file and make sure appsscript.json contains the oauthScopes from the
 * WaterOps appsscript.json file.
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
  closedLoops: 'Closed Loop Log',
  blueRiiotReadings: 'BlueRiiot Readings',
  blueRiiotDevices: 'BlueRiiot Devices'
};

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  var action = String(params.action || '');
  var callback = String(params.callback || '');

  if (action === 'blueRiiotSnapshot') {
    return jsonp_(callback, buildBlueRiiotSnapshot_(params));
  }
  if (action === 'blueRiiotDevices') {
    return jsonp_(callback, buildBlueRiiotDevicesResponse_());
  }
  if (action === 'blueRiiotDiagnostics') {
    return jsonp_(callback, buildBlueRiiotDiagnostics_());
  }
  if (action === 'setupBlueRiiotSheets') {
    setupBlueRiiotSheets_();
    return jsonp_(callback, {
      ok: true,
      message: 'BlueRiiot sheets are ready. Add BLUERIIOT_EMAIL and BLUERIIOT_PASSWORD in Apps Script Project Settings > Script properties.'
    });
  }

  if (action === 'costSnapshot') {
    return jsonp_(callback, {
      ok: true,
      snapshot: buildCostSnapshot_()
    });
  }
  if (action === 'technicianList') {
    var technicians = buildTechnicianAccess_();
    return jsonp_(callback, {
      ok: true,
      names: buildTechnicianList_(technicians),
      technicians: technicians
    });
  }
  if (action === 'verifyTechnician') {
    return jsonp_(callback, verifyTechnician_(params.name, params.pin));
  }

  if (action === 'setupTechnicianSheet') {
    ensureTechnicianHeader_(getOrCreateSheet_(SHEETS.technicians));
    return jsonp_(callback, {
      ok: true,
      message: 'Technicians sheet is ready with Name, Role, PIN and Active columns.'
    });
  }


  return jsonp_(callback, {
    ok: true,
    message: 'WaterOps Google Sheets bridge is running.',
    availableActions: ['costSnapshot', 'technicianList', 'verifyTechnician', 'setupTechnicianSheet', 'setupBlueRiiotSheets', 'blueRiiotDevices', 'blueRiiotSnapshot', 'blueRiiotDiagnostics', 'closedLoopVisit POST']
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

function authoriseWaterOpsServices() {
  PropertiesService.getScriptProperties().getProperties();
  getSpreadsheet_();
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  return 'WaterOps permissions are authorised. Redeploy the web app after this runs successfully.';
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

function ensureTechnicianHeader_(sheet) {
  var header = ['Name', 'Role', 'PIN', 'Active'];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
    return;
  }
  var existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), header.length)).getValues()[0];
  for (var i = 0; i < header.length; i += 1) {
    if (!existing[i]) existing[i] = header[i];
  }
  sheet.getRange(1, 1, 1, header.length).setValues([existing.slice(0, header.length)]);
}

function normaliseRole_(role) {
  var clean = String(role || '').trim().toLowerCase();
  if (clean === 'admin' || clean === 'supervisor' || clean === 'tech') return clean;
  return '';
}

function isActiveTechnician_(value) {
  var clean = String(value == null ? 'yes' : value).trim().toLowerCase();
  return !(clean === 'no' || clean === 'false' || clean === 'inactive' || clean === '0');
}

function getHeaderIndex_(headers, names, fallback) {
  for (var i = 0; i < names.length; i += 1) {
    if (headers[names[i]] != null) return headers[names[i]];
  }
  return fallback;
}

function buildTechnicianAccess_() {
  var sheet = getOrCreateSheet_(SHEETS.technicians);
  ensureTechnicianHeader_(sheet);

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = {};
  for (var h = 0; h < values[0].length; h += 1) {
    headers[String(values[0][h] || '').trim().toLowerCase()] = h;
  }
  var nameIndex = getHeaderIndex_(headers, ['name', 'technician_name', 'technician'], 0);
  var roleIndex = getHeaderIndex_(headers, ['role', 'access_role'], -1);
  var pinIndex = getHeaderIndex_(headers, ['pin', 'access_pin'], -1);
  var activeIndex = getHeaderIndex_(headers, ['active', 'enabled'], -1);
  var technicians = [];
  var seen = {};
  for (var i = 1; i < values.length; i += 1) {
    var row = values[i];
    var name = String(row[nameIndex] || '').trim();
    if (!name) continue;
    var key = name.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    technicians.push({
      name: name,
      role: normaliseRole_(roleIndex >= 0 ? row[roleIndex] : ''),
      pinRequired: pinIndex >= 0 && String(row[pinIndex] || '').trim() !== '',
      active: activeIndex >= 0 ? isActiveTechnician_(row[activeIndex]) : true
    });
  }
  technicians.sort(function(a, b) { return a.name.localeCompare(b.name); });
  return technicians;
}

function buildTechnicianList_(technicians) {
  var list = technicians || buildTechnicianAccess_();
  var names = [];
  for (var i = 0; i < list.length; i += 1) {
    if (list[i].active !== false) names.push(list[i].name);
  }
  names.sort();
  return names;
}

function verifyTechnician_(name, pin) {
  var cleanName = String(name || '').trim();
  if (!cleanName) return { ok: false, verified: false, error: 'Technician name is required.' };
  var sheet = getOrCreateSheet_(SHEETS.technicians);
  ensureTechnicianHeader_(sheet);
  var values = sheet.getDataRange().getValues();
  var headers = {};
  for (var h = 0; h < values[0].length; h += 1) {
    headers[String(values[0][h] || '').trim().toLowerCase()] = h;
  }
  var nameIndex = getHeaderIndex_(headers, ['name', 'technician_name', 'technician'], 0);
  var roleIndex = getHeaderIndex_(headers, ['role', 'access_role'], -1);
  var pinIndex = getHeaderIndex_(headers, ['pin', 'access_pin'], -1);
  var activeIndex = getHeaderIndex_(headers, ['active', 'enabled'], -1);
  for (var i = 1; i < values.length; i += 1) {
    var row = values[i];
    if (String(row[nameIndex] || '').trim().toLowerCase() !== cleanName.toLowerCase()) continue;
    if (activeIndex >= 0 && !isActiveTechnician_(row[activeIndex])) return { ok: false, verified: false, error: 'Technician is inactive.' };
    var storedPin = pinIndex >= 0 ? String(row[pinIndex] || '').trim() : '';
    if (storedPin && String(pin || '').trim() !== storedPin) return { ok: false, verified: false, error: 'Incorrect PIN.' };
    return {
      ok: true,
      verified: true,
      name: String(row[nameIndex] || '').trim(),
      role: normaliseRole_(roleIndex >= 0 ? row[roleIndex] : '')
    };
  }
  return { ok: false, verified: false, error: 'Technician was not found.' };
}
function getBlueRiiotConfig_() {
  var props = PropertiesService.getScriptProperties();
  return {
    email: props.getProperty('BLUERIIOT_EMAIL') || '',
    password: props.getProperty('BLUERIIOT_PASSWORD') || '',
    apiBase: props.getProperty('BLUERIIOT_API_BASE') || 'https://api.riiotlabs.com',
    region: props.getProperty('BLUERIIOT_REGION') || 'eu-west-1',
    language: props.getProperty('BLUERIIOT_LANGUAGE') || 'en',
    poolMap: parseJsonObject_(props.getProperty('BLUERIIOT_POOL_MAP') || '{}')
  };
}

function setupBlueRiiotSheets_() {
  appendRows_(SHEETS.blueRiiotDevices, [blueRiiotDeviceHeader_()]);
  appendRows_(SHEETS.blueRiiotReadings, [blueRiiotReadingHeader_()]);
}

function buildBlueRiiotDevicesResponse_() {
  try {
    var devices = fetchBlueRiiotDevices_();
    upsertBlueRiiotDevices_(devices);
    return { ok: true, devices: devices, count: devices.length };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

function buildBlueRiiotSnapshot_(params) {
  try {
    var readings = fetchBlueRiiotReadings_();
    var filtered = filterBlueRiiotReadings_(readings, params || {});
    if (readings.length) appendBlueRiiotReadingRows_(readings);
    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      count: filtered.length,
      readings: filtered
    };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

function buildBlueRiiotDiagnostics_() {
  var out = {
    ok: false,
    checkedAt: new Date().toISOString(),
    config: {},
    steps: []
  };
  try {
    var config = getBlueRiiotConfig_();
    out.config = {
      emailSet: !!config.email,
      passwordSet: !!config.password,
      apiBase: config.apiBase,
      region: config.region,
      language: config.language
    };
    if (!config.email || !config.password) {
      out.steps.push({ step: 'scriptProperties', ok: false, message: 'Missing BLUERIIOT_EMAIL or BLUERIIOT_PASSWORD.' });
      return out;
    }
    out.steps.push({ step: 'scriptProperties', ok: true, message: 'BlueRiiot email/password properties are present.' });

    try {
      UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
      out.steps.push({ step: 'externalRequestPermission', ok: true, message: 'UrlFetchApp external request permission is available.' });
    } catch (permissionError) {
      out.steps.push({ step: 'externalRequestPermission', ok: false, message: String(permissionError && permissionError.message ? permissionError.message : permissionError) });
      return out;
    }

    var session = blueRiiotLogin_(config);
    out.steps.push({ step: 'login', ok: true, message: 'BlueRiiot login returned temporary API credentials.' });

    var poolsResponse = blueRiiotSignedGet_(config, session, '/prod/swimming_pool/', {});
    var pools = extractBlueRiiotArray_(poolsResponse, ['data', 'swimming_pools', 'swimmingPools', 'pools']);
    out.poolCount = pools.length;
    out.steps.push({ step: 'pools', ok: pools.length > 0, message: 'BlueRiiot swimming pools returned: ' + pools.length });

    var devices = fetchBlueRiiotDevicesWithSession_(config, session);
    out.deviceCount = devices.length;
    out.deviceSamples = devices.slice(0, 5).map(function(d) {
      return {
        swimmingPoolId: d.swimmingPoolId || '',
        swimmingPoolName: d.swimmingPoolName || '',
        blueSerial: d.blueSerial || '',
        deviceName: d.deviceName || ''
      };
    });
    out.steps.push({ step: 'devices', ok: devices.length > 0, message: 'BlueRiiot devices returned: ' + devices.length });
    out.ok = out.steps.every(function(step) { return step.ok; });
    return out;
  } catch (error) {
    out.error = String(error && error.message ? error.message : error);
    out.steps.push({ step: 'error', ok: false, message: out.error });
    return out;
  }
}

function fetchBlueRiiotDevices_() {
  var config = getBlueRiiotConfig_();
  if (!config.email || !config.password) throw new Error('Missing BLUERIIOT_EMAIL or BLUERIIOT_PASSWORD in Script properties.');
  var session = blueRiiotLogin_(config);
  var poolsResponse = blueRiiotSignedGet_(config, session, '/prod/swimming_pool', { deleted: 'false' });
  var pools = extractBlueRiiotArray_(poolsResponse, ['data', 'swimming_pools', 'swimmingPools', 'pools']);
  var devices = [];
  for (var i = 0; i < pools.length; i += 1) {
    var pool = pools[i] || {};
    var poolId = String(pool.id || pool.swimming_pool_id || pool.uuid || pool._id || '');
    if (!poolId) continue;
    var poolName = String(pool.name || pool.title || pool.label || poolId);
    var blueResponse = blueRiiotSignedGet_(config, session, '/prod/swimming_pool/' + encodeURIComponent(poolId) + '/blue', null);
    var blueItems = extractBlueRiiotDeviceItems_(blueResponse);
    for (var b = 0; b < blueItems.length; b += 1) {
      var item = blueItems[b] || {};
      var blue = item.blue_device || item.device || item;
      var serial = getBlueRiiotDeviceSerial_(blue, item);
      if (!serial) continue;
      devices.push({
        swimmingPoolId: poolId,
        swimmingPoolName: poolName,
        blueSerial: serial,
        deviceName: String(blue.name || blue.label || poolName),
        waterOpsPoolKey: resolveBlueRiiotPoolKey_(config.poolMap, poolId, poolName, serial),
        rawPoolJson: JSON.stringify(pool),
        rawDeviceJson: JSON.stringify(blue)
      });
    }
  }
  return devices;
}

function fetchBlueRiiotReadings_() {
  var config = getBlueRiiotConfig_();
  if (!config.email || !config.password) throw new Error('Missing BLUERIIOT_EMAIL or BLUERIIOT_PASSWORD in Script properties.');
  var session = blueRiiotLogin_(config);
  var devices = fetchBlueRiiotDevicesWithSession_(config, session);
  var readings = [];
  for (var i = 0; i < devices.length; i += 1) {
    var device = devices[i];
    var path = '/prod/swimming_pool/' + encodeURIComponent(device.swimmingPoolId) + '/blue/' + encodeURIComponent(device.blueSerial) + '/lastMeasurements';
    var response = blueRiiotSignedGet_(config, session, path, { mode: 'blue_and_strip' });
    var measurementRows = extractBlueRiiotArray_(response, ['data', 'measurements', 'lastMeasurements']);
    var reading = normaliseBlueRiiotReading_(device, response, measurementRows);
    readings.push(reading);
  }
  upsertBlueRiiotDevices_(devices);
  return readings;
}

function fetchBlueRiiotDevicesWithSession_(config, session) {
  var poolsResponse = blueRiiotSignedGet_(config, session, '/prod/swimming_pool', { deleted: 'false' });
  var pools = extractBlueRiiotArray_(poolsResponse, ['data', 'swimming_pools', 'swimmingPools', 'pools']);
  var devices = [];
  for (var i = 0; i < pools.length; i += 1) {
    var pool = pools[i] || {};
    var poolId = String(pool.id || pool.swimming_pool_id || pool.uuid || pool._id || '');
    if (!poolId) continue;
    var poolName = String(pool.name || pool.title || pool.label || poolId);
    var blueResponse = blueRiiotSignedGet_(config, session, '/prod/swimming_pool/' + encodeURIComponent(poolId) + '/blue', null);
    var blueItems = extractBlueRiiotDeviceItems_(blueResponse);
    for (var b = 0; b < blueItems.length; b += 1) {
      var item = blueItems[b] || {};
      var blue = item.blue_device || item.device || item;
      var serial = getBlueRiiotDeviceSerial_(blue, item);
      if (!serial) continue;
      devices.push({
        swimmingPoolId: poolId,
        swimmingPoolName: poolName,
        blueSerial: serial,
        deviceName: String(blue.name || blue.label || poolName),
        waterOpsPoolKey: resolveBlueRiiotPoolKey_(config.poolMap, poolId, poolName, serial),
        rawPoolJson: JSON.stringify(pool),
        rawDeviceJson: JSON.stringify(blue)
      });
    }
  }
  return devices;
}

function blueRiiotLogin_(config) {
  var response = UrlFetchApp.fetch(config.apiBase + '/prod/user/login', {
    method: 'post',
    contentType: 'application/json',
    headers: getBlueRiiotBaseHeaders_(config),
    muteHttpExceptions: true,
    payload: JSON.stringify({ email: config.email, password: config.password })
  });
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code < 200 || code >= 300) throw new Error('BlueRiiot login failed: HTTP ' + code + ' ' + text.slice(0, 220));
  var json = JSON.parse(text || '{}');
  var credentials = findCredentialsObject_(json);
  if (!credentials.accessKeyId || !credentials.secretAccessKey || !credentials.sessionToken) {
    throw new Error('BlueRiiot login did not return temporary API credentials. Response shape may have changed.');
  }
  return credentials;
}

function getBlueRiiotBaseHeaders_(config) {
  return {
    'User-Agent': 'BlueConnect/3.2.1',
    'Accept-Language': (config.language || 'en') + ';q=1.0',
    'Accept': '**'
  };
}

function blueRiiotSignedGet_(config, session, path, query) {
  var signed = signAwsGet_(config.apiBase, path, query || {}, config.region, session);
  var response = UrlFetchApp.fetch(signed.url, {
    method: 'get',
    headers: signed.headers,
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code < 200 || code >= 300) throw new Error('BlueRiiot API request failed: HTTP ' + code + ' ' + signed.pathWithQuery + ' ' + text.slice(0, 220));
  return JSON.parse(text || '{}');
}

function normaliseBlueRiiotReading_(device, response, measurements) {
  var reading = {
    receivedAt: new Date().toISOString(),
    waterOpsPoolKey: device.waterOpsPoolKey || '',
    swimmingPoolId: device.swimmingPoolId,
    swimmingPoolName: device.swimmingPoolName,
    blueSerial: device.blueSerial,
    deviceName: device.deviceName,
    timestamp: response.last_blue_measure_timestamp || response.timestamp || '',
    ph: '',
    orp: '',
    temperature: '',
    salinity: '',
    conductivity: '',
    rawJson: JSON.stringify(response)
  };
  for (var i = 0; i < measurements.length; i += 1) {
    var item = measurements[i] || {};
    var name = String(item.name || item.type || item.key || '').toLowerCase();
    var value = item.value == null ? '' : item.value;
    if (name === 'ph' || name === 'pH'.toLowerCase()) reading.ph = value;
    if (name === 'orp' || name === 'redox') reading.orp = value;
    if (name === 'temperature' || name === 'temp') reading.temperature = value;
    if (name === 'salinity' || name === 'salt') reading.salinity = value;
    if (name === 'conductivity') reading.conductivity = value;
    if (!reading.timestamp && item.timestamp) reading.timestamp = item.timestamp;
  }
  return reading;
}

function filterBlueRiiotReadings_(readings, params) {
  var poolKey = String(params.poolKey || '').trim();
  var serial = String(params.blueSerial || '').trim();
  var swimmingPoolId = String(params.swimmingPoolId || '').trim();
  if (!poolKey && !serial && !swimmingPoolId) return readings;
  var filtered = [];
  for (var i = 0; i < readings.length; i += 1) {
    var item = readings[i];
    if (poolKey && item.waterOpsPoolKey !== poolKey) continue;
    if (serial && item.blueSerial !== serial) continue;
    if (swimmingPoolId && item.swimmingPoolId !== swimmingPoolId) continue;
    filtered.push(item);
  }
  return filtered;
}

function extractBlueRiiotDeviceItems_(blueResponse) {
  var items = extractBlueRiiotArray_(blueResponse, ['data', 'blue', 'devices', 'items']);
  if (items.length) return items;
  var data = blueResponse && blueResponse.data;
  var candidates = [
    blueResponse && blueResponse.blue,
    blueResponse && blueResponse.device,
    data && data.blue,
    data && data.device,
    data && data.blue_device,
    data && data.device_data
  ];
  for (var i = 0; i < candidates.length; i += 1) {
    if (candidates[i] && typeof candidates[i] === 'object' && !Array.isArray(candidates[i])) return [candidates[i]];
  }
  return [];
}

function getBlueRiiotDeviceSerial_(blue, item) {
  blue = blue || {};
  item = item || {};
  var candidates = [
    blue.serial,
    blue.blue_device_serial,
    blue.blueDeviceSerial,
    blue.serial_number,
    blue.serialNumber,
    blue.device_serial,
    blue.deviceSerial,
    blue.mac,
    blue.uuid,
    blue.id,
    item.serial,
    item.blue_device_serial,
    item.blueDeviceSerial,
    item.serial_number,
    item.serialNumber,
    item.device_serial,
    item.deviceSerial,
    item.uuid,
    item.id
  ];
  for (var i = 0; i < candidates.length; i += 1) {
    if (candidates[i] != null && String(candidates[i]).trim()) return String(candidates[i]).trim();
  }
  return '';
}

function appendBlueRiiotReadingRows_(readings) {
  var rows = [blueRiiotReadingHeader_()];
  for (var i = 0; i < readings.length; i += 1) {
    var r = readings[i];
    rows.push([
      new Date(), r.timestamp || '', r.waterOpsPoolKey || '', r.swimmingPoolId || '', r.swimmingPoolName || '',
      r.blueSerial || '', r.deviceName || '', r.ph, r.orp, r.temperature, r.salinity, r.conductivity, r.rawJson || ''
    ]);
  }
  appendRows_(SHEETS.blueRiiotReadings, rows);
}

function upsertBlueRiiotDevices_(devices) {
  if (!devices || !devices.length) {
    appendRows_(SHEETS.blueRiiotDevices, [blueRiiotDeviceHeader_()]);
    return;
  }
  var rows = [blueRiiotDeviceHeader_()];
  for (var i = 0; i < devices.length; i += 1) {
    var d = devices[i];
    rows.push([new Date(), d.waterOpsPoolKey || '', d.swimmingPoolId || '', d.swimmingPoolName || '', d.blueSerial || '', d.deviceName || '', d.rawPoolJson || '', d.rawDeviceJson || '']);
  }
  var sheet = getOrCreateSheet_(SHEETS.blueRiiotDevices);
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
}

function blueRiiotReadingHeader_() {
  return ['receivedAt', 'measurementTimestamp', 'waterOpsPoolKey', 'swimmingPoolId', 'swimmingPoolName', 'blueSerial', 'deviceName', 'ph', 'orp', 'temperature', 'salinity', 'conductivity', 'rawJson'];
}

function blueRiiotDeviceHeader_() {
  return ['updatedAt', 'waterOpsPoolKey', 'swimmingPoolId', 'swimmingPoolName', 'blueSerial', 'deviceName', 'rawPoolJson', 'rawDeviceJson'];
}

function resolveBlueRiiotPoolKey_(poolMap, poolId, poolName, serial) {
  poolMap = poolMap || {};
  return poolMap[serial] || poolMap[poolId] || poolMap[poolName] || '';
}

function extractBlueRiiotArray_(value, keys) {
  if (Array.isArray(value)) return value;
  for (var i = 0; i < keys.length; i += 1) {
    var key = keys[i];
    if (value && Array.isArray(value[key])) return value[key];
  }
  if (value && Array.isArray(value.data)) return value.data;
  if (value && value.data && typeof value.data === 'object') {
    for (var prop in value.data) {
      if (value.data.hasOwnProperty(prop) && Array.isArray(value.data[prop])) return value.data[prop];
    }
  }
  return [];
}

function parseJsonObject_(text) {
  try {
    var parsed = JSON.parse(text || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function findCredentialsObject_(json) {
  var candidates = [json, json.data, json.credentials, json.Credentials, json.data && json.data.credentials, json.data && json.data.Credentials];
  for (var i = 0; i < candidates.length; i += 1) {
    var c = candidates[i] || {};
    var accessKeyId = c.accessKeyId || c.AccessKeyId || c.access_key || c.accessKey || c.aws_access_key_id;
    var secretAccessKey = c.secretAccessKey || c.SecretAccessKey || c.secret_key || c.secretKey || c.aws_secret_access_key;
    var sessionToken = c.sessionToken || c.SessionToken || c.session_token || c.securityToken || c.Token;
    if (accessKeyId && secretAccessKey && sessionToken) {
      return {
        accessKeyId: String(accessKeyId),
        secretAccessKey: String(secretAccessKey),
        sessionToken: String(sessionToken)
      };
    }
  }
  return {};
}

function signAwsGet_(baseUrl, path, query, region, session) {
  var endpoint = parseUrl_(baseUrl);
  var now = new Date();
  var amzDate = Utilities.formatDate(now, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  var dateStamp = Utilities.formatDate(now, 'UTC', 'yyyyMMdd');
  var canonicalUri = canonicalUri_(path);
  var canonicalQuery = canonicalQueryString_(query || {});
  var host = endpoint.host;
  var headers = {
    host: host,
    'x-amz-date': amzDate,
    'x-amz-security-token': session.sessionToken
  };
  var signedHeaders = 'host;x-amz-date;x-amz-security-token';
  var canonicalHeaders = 'host:' + host + '\n' + 'x-amz-date:' + amzDate + '\n' + 'x-amz-security-token:' + session.sessionToken + '\n';
  var payloadHash = sha256Hex_('');
  var canonicalRequest = ['GET', canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  var credentialScope = dateStamp + '/' + region + '/execute-api/aws4_request';
  var stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex_(canonicalRequest)].join('\n');
  var signingKey = getAwsSignatureKey_(session.secretAccessKey, dateStamp, region, 'execute-api');
  var signature = bytesToHex_(hmacSha256Bytes_(stringToSign, signingKey));
  var authorization = 'AWS4-HMAC-SHA256 Credential=' + session.accessKeyId + '/' + credentialScope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
  return {
    url: baseUrl.replace(/\/$/, '') + canonicalUri + (canonicalQuery ? '?' + canonicalQuery : ''),
    pathWithQuery: canonicalUri + (canonicalQuery ? '?' + canonicalQuery : ''),
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'WaterOps Google Apps Script',
      'X-Amz-Date': amzDate,
      'X-Amz-Security-Token': session.sessionToken,
      'Authorization': authorization
    }
  };
}

function getAwsSignatureKey_(key, dateStamp, regionName, serviceName) {
  var kDate = Utilities.computeHmacSha256Signature(dateStamp, 'AWS4' + key);
  var kRegion = hmacSha256Bytes_(regionName, kDate);
  var kService = hmacSha256Bytes_(serviceName, kRegion);
  return hmacSha256Bytes_('aws4_request', kService);
}

function hmacSha256Bytes_(value, keyBytes) {
  return Utilities.computeHmacSha256Signature(Utilities.newBlob(String(value)).getBytes(), keyBytes);
}

function canonicalUri_(path) {
  var clean = String(path || '/');
  if (clean.charAt(0) !== '/') clean = '/' + clean;
  return clean.split('/').map(function(part) { return encodeURIComponent(decodeURIComponent(part)); }).join('/');
}

function canonicalQueryString_(query) {
  var parts = [];
  for (var key in query) {
    if (query.hasOwnProperty(key) && query[key] != null && query[key] !== '') {
      parts.push([encodeURIComponent(key), encodeURIComponent(String(query[key]))]);
    }
  }
  parts.sort(function(a, b) {
    if (a[0] === b[0]) return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
    return a[0] < b[0] ? -1 : 1;
  });
  return parts.map(function(pair) { return pair[0] + '=' + pair[1]; }).join('&');
}

function sha256Hex_(text) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}

function bytesToHex_(bytes) {
  return bytes.map(function(byte) {
    var value = byte;
    if (value < 0) value += 256;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
}

function parseUrl_(url) {
  var match = String(url || '').match(/^https?:\/\/([^\/]+)(.*)$/i);
  if (!match) throw new Error('Invalid URL: ' + url);
  return { host: match[1], path: match[2] || '' };
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
  var equipment = payload.equipment || {};
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
      equipment.manufacturer || '',
      equipment.model || '',
      equipment.serial || '',
      equipment.equipmentType || '',
      equipment.material || '',
      equipment.source || '',
      equipment.parameterNote || '',
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
    'manufacturer', 'model', 'serial', 'equipmentType', 'heatExchangerMaterial', 'manufacturerSource', 'manufacturerParameterNote',
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
  } else if (header.length > sheet.getLastColumn()) {
    var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    for (var h = 0; h < header.length; h += 1) {
      if (!existing[h]) existing[h] = header[h];
    }
    sheet.getRange(1, 1, 1, header.length).setValues([existing]);
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
