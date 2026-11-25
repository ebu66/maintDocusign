'use strict';
// テスト用の偽 GAS。
// チェッカ.js を Node の vm に読み込み、SpreadsheetApp などの GAS のサービスを偽物に差し替えて動かす。
// 本物のスプレッドシートや Docusign には一切触れない。

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CHECKER_PATH = path.join(__dirname, '..', '..', 'チェッカ.js');

// 2 次元配列を、テストコードと同じ realm の配列に写す。
// vm の中で作られた配列は別の realm のものなので、そのままだと assert.deepStrictEqual がプロトタイプの違いで失敗する。
function copyValues(values) {
  return Array.from(values, row => Array.from(row));
}

function createFakeSheet(name, initialValues, sheetId) {
  let grid = copyValues(initialValues);

  const lastRow = () => grid.length;
  const lastColumn = () => grid.reduce((max, row) => Math.max(max, row.length), 0);
  const cellValue = (r, c) => { // 0 始まり
    const row = grid[r];
    return row && c < row.length && row[c] !== undefined ? row[c] : '';
  };

  function createRange(row, column, numRows, numColumns) {
    if (![row, column, numRows, numColumns].every(n => Number.isInteger(n) && n >= 1)) {
      throw new Error(`範囲の指定が不正です: getRange(${row}, ${column}, ${numRows}, ${numColumns})`);
    }
    const range = {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const line = [];
          for (let c = 0; c < numColumns; c++) {
            line.push(cellValue(row - 1 + r, column - 1 + c));
          }
          out.push(line);
        }
        return out;
      },
      // GAS と同じく、データの行数・列数が範囲と一致しなければ例外にする
      setValues(values) {
        if (values.length !== numRows || Array.from(values).some(line => line.length !== numColumns)) {
          const actualColumns = values.length > 0 ? values[0].length : 0;
          throw new Error(`データの行数・列数（${values.length} 行 × ${actualColumns} 列）が範囲（${numRows} 行 × ${numColumns} 列）と一致しません`);
        }
        copyValues(values).forEach((line, r) => {
          line.forEach((value, c) => {
            const rr = row - 1 + r;
            const cc = column - 1 + c;
            while (grid.length <= rr) {
              grid.push([]);
            }
            while (grid[rr].length < cc) {
              grid[rr].push('');
            }
            grid[rr][cc] = value;
          });
        });
        return range;
      },
      setNumberFormat() {
        return range;
      }
    };
    return range;
  }

  const sheet = {
    getName: () => name,
    getSheetId: () => sheetId,
    getLastRow: lastRow,
    getLastColumn: lastColumn,
    // 空のシートでは、GAS と同じく A1 だけの範囲を返す
    getDataRange: () => createRange(1, 1, Math.max(lastRow(), 1), Math.max(lastColumn(), 1)),
    getRange: createRange,
    clear() {
      grid = [];
      return sheet;
    },
    clearContents() {
      grid = [];
      return sheet;
    },
    // テスト用：シートの中身を、行の長さをそろえた 2 次元配列で返す（空なら []）
    values() {
      const width = lastColumn();
      return grid.map(row => Array.from({ length: width }, (_, c) => (c < row.length && row[c] !== undefined ? row[c] : '')));
    }
  };
  return sheet;
}

// { シート名: 2 次元配列 } から偽のスプレッドシートを作る
function createFakeSpreadsheet(sheetValues = {}) {
  const sheets = [];
  let nextSheetId = 1;
  const addSheet = (name, values) => {
    const sheet = createFakeSheet(name, values, nextSheetId++);
    sheets.push(sheet);
    return sheet;
  };
  Object.entries(sheetValues).forEach(([name, values]) => addSheet(name, values));

  const spreadsheet = {
    getId: () => 'fake-spreadsheet-id',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/fake-spreadsheet-id/edit',
    getSheets: () => sheets.slice(),
    getSheetByName: name => sheets.find(sheet => sheet.getName() === name) || null,
    insertSheet(name) {
      if (spreadsheet.getSheetByName(name)) {
        throw new Error(`シート「${name}」は既にあります`);
      }
      return addSheet(name, []);
    },
    // テスト用：シート名の一覧
    sheetNames: () => sheets.map(sheet => sheet.getName()),
    // テスト用：シートの中身（シートがなければ undefined）
    valuesOf(name) {
      const sheet = spreadsheet.getSheetByName(name);
      return sheet ? sheet.values() : undefined;
    }
  };
  return spreadsheet;
}

// 触ったら例外を投げるサービス。テスト対象が外部サービスを呼ばないことを確かめる
function unexpectedService(serviceName) {
  return new Proxy({}, {
    get(_, property) {
      throw new Error(`テスト中に ${serviceName}.${String(property)} が使われました`);
    }
  });
}

// 偽の UrlFetchApp。respond(url, options) が { status, body } を返す（body は文字列かオブジェクト。オブジェクトは JSON にする）。
// 呼ばれた URL とオプションは calls に残る。
function createFakeUrlFetchApp(respond) {
  const calls = [];
  return {
    calls,
    fetch(url, options = {}) {
      calls.push({ url, options });
      const { status = 200, body = '' } = respond(url, options);
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      return {
        getResponseCode: () => status,
        getContentText: () => text
      };
    }
  };
}

// 偽の Utilities。Docusign の JWT の作成に使う関数だけを持つ（署名の中身は確かめない）
function createFakeUtilities() {
  return {
    base64EncodeWebSafe: data => Buffer.from(typeof data === 'string' ? data : Uint8Array.from(data, b => b & 0xff)).toString('base64url'),
    computeRsaSha256Signature: () => [1, 2, 3]
  };
}

// チェッカ.js を読み込んだ vm のコンテキストを返す。
// トップレベルの function はコンテキストのプロパティになるので、ctx.createMaintenanceSheet() のように呼べる。
// UrlFetchApp・MailApp・AdminDirectory・Utilities は、既定では触ると例外になる。services で差し替えられる。
function loadChecker({ spreadsheet, properties = {}, services = {} } = {}) {
  const messages = [];
  const record = level => (...args) => messages.push({ level, text: args.map(String).join(' ') });

  const context = vm.createContext({
    SpreadsheetApp: {
      openById: () => spreadsheet,
      getActiveSpreadsheet: () => spreadsheet
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => (Object.prototype.hasOwnProperty.call(properties, key) ? properties[key] : null)
      })
    },
    UrlFetchApp: unexpectedService('UrlFetchApp'),
    MailApp: unexpectedService('MailApp'),
    AdminDirectory: unexpectedService('AdminDirectory'),
    Utilities: unexpectedService('Utilities'),
    console: {
      messages,
      log: record('log'),
      info: record('info'),
      warn: record('warn'),
      error: record('error')
    },
    ...services
  });
  vm.runInContext(fs.readFileSync(CHECKER_PATH, 'utf8'), context, { filename: CHECKER_PATH });
  return context;
}

module.exports = { createFakeSpreadsheet, createFakeUrlFetchApp, createFakeUtilities, loadChecker };
