'use strict';
// メンテナンス用シートの生成（spec.md の「メンテナンス用シートの生成」）のテスト。
// 偽 GAS（helpers/gas.js）では UrlFetchApp・MailApp・AdminDirectory に触れると例外になるので、
// どのテストも「外部サービスを呼ばないこと」をあわせて確かめている。

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSpreadsheet, loadChecker } = require('./helpers/gas');

const GROUP_LIST = '共有事務グループ一覧';
const CSV = 'メンテナンス用CSV';
const CSV_HEADER = ['UserEmail', 'APIUserName', 'FirstName', 'LastName', 'PermissionSet', 'CompanyName', 'Group', 'Language'];
const LEDGER_HEADER = ['氏名', 'メールアドレス', '更新対象'];

// 「共有事務グループ一覧」シート。C 列 = グループ名称、D 列 = グループのメールアドレス、E 列 = 台帳シート名。
// 実際のシートと同じく、見出し行と空行を含める。
function groupList(...ledgerSheetNames) {
  const blank = ['', '', '', '', ''];
  return [
    ['', '', 'グループ名称', 'グループのメールアドレス', '台帳シート名'],
    blank,
    ...ledgerSheetNames.map((name, i) => ['', '', `${name}グループ`, `group${i + 1}@example.com`, name]),
    blank
  ];
}

// 台帳シート。A 列 = 氏名、B 列 = メールアドレス、C 列 = 更新対象（チェックボックス）
function ledger(...rows) {
  return [LEDGER_HEADER, ...rows];
}

function csvRow(email, firstName, lastName, group) {
  return [email, '', firstName, lastName, 'DS Sender', '株式会社ODKソリューションズ', group, 'ja'];
}

function setup(sheets) {
  const spreadsheet = createFakeSpreadsheet(sheets);
  const gas = loadChecker({ spreadsheet });
  return { spreadsheet, gas };
}

test('テストの土台：チェッカ.js を偽 GAS に読み込める', () => {
  const { gas } = setup({ [GROUP_LIST]: groupList() });
  assert.equal(typeof gas.checkGroupMembers, 'function');
  assert.equal(typeof gas.checkDocusignUsers, 'function');
});

describe('createMaintenanceSheet', () => {
  test('チェックが付いた行だけを、見出しと 8 列で出力する', () => {
    const { spreadsheet, gas } = setup({
      [GROUP_LIST]: groupList('経理'),
      '経理': ledger(
        ['吉田 翔', 'yoshida@example.com', true],
        ['佐藤 一郎', 'sato@example.com', false]
      )
    });

    gas.createMaintenanceSheet();

    assert.deepEqual(spreadsheet.valuesOf(CSV), [
      CSV_HEADER,
      csvRow('yoshida@example.com', '翔', '吉田', '経理')
    ]);
  });

  test('複数のシートの行を、一覧の順、シートの中では上から順に出力する', () => {
    const { spreadsheet, gas } = setup({
      [GROUP_LIST]: groupList('経理', '総務'),
      // シートの並び順ではなく、一覧の順で出力されることを確かめるため、総務を先に置く
      '総務': ledger(['山本 健', 'yamamoto@example.com', true]),
      '経理': ledger(
        ['吉田 翔', 'yoshida@example.com', true],
        ['田中 美咲', 'tanaka@example.com', true]
      )
    });

    gas.createMaintenanceSheet();

    assert.deepEqual(spreadsheet.valuesOf(CSV), [
      CSV_HEADER,
      csvRow('yoshida@example.com', '翔', '吉田', '経理'),
      csvRow('tanaka@example.com', '美咲', '田中', '経理'),
      csvRow('yamamoto@example.com', '健', '山本', '総務')
    ]);
  });

  test('チェックなし・チェック欄が空・メールアドレスが空の行と、台帳の空行は出力しない', () => {
    const { spreadsheet, gas } = setup({
      [GROUP_LIST]: groupList('経理'),
      '経理': ledger(
        ['吉田 翔', 'yoshida@example.com', true],
        ['佐藤 一郎', 'sato@example.com', false],
        ['鈴木 次郎', 'suzuki@example.com', ''],
        ['高橋 三郎', '', true],
        ['', '', ''],
        ['伊藤 四郎', 'ito@example.com', true]
      )
    });

    gas.createMaintenanceSheet();

    assert.deepEqual(spreadsheet.valuesOf(CSV), [
      CSV_HEADER,
      csvRow('yoshida@example.com', '翔', '吉田', '経理'),
      csvRow('ito@example.com', '四郎', '伊藤', '経理')
    ]);
  });

  test('一覧の見出し行と空行は、シートとして扱わない', () => {
    // groupList() は見出し行と空行を含む。これをシート名として探すと「見つからない」エラーになる
    const { spreadsheet, gas } = setup({
      [GROUP_LIST]: groupList('経理'),
      '経理': ledger(['吉田 翔', 'yoshida@example.com', true])
    });

    assert.doesNotThrow(() => gas.createMaintenanceSheet());
    assert.deepEqual(spreadsheet.valuesOf(CSV), [
      CSV_HEADER,
      csvRow('yoshida@example.com', '翔', '吉田', '経理')
    ]);
  });

  test('氏名は半角・全角のスペースで姓と名に分け、連続したスペースや前後の空白は無視する', () => {
    const { spreadsheet, gas } = setup({
      [GROUP_LIST]: groupList('経理'),
      '経理': ledger(
        ['山田　花子', 'yamada@example.com', true], // 全角スペース
        ['鈴木  次郎', 'suzuki@example.com', true], // 半角スペース 2 つ
        ['高橋 　三郎', 'takahashi@example.com', true], // 半角と全角
        [' 伊藤 四郎　', 'ito@example.com', true] // 前後に空白
      )
    });

    gas.createMaintenanceSheet();

    assert.deepEqual(spreadsheet.valuesOf(CSV), [
      CSV_HEADER,
      csvRow('yamada@example.com', '花子', '山田', '経理'),
      csvRow('suzuki@example.com', '次郎', '鈴木', '経理'),
      csvRow('takahashi@example.com', '三郎', '高橋', '経理'),
      csvRow('ito@example.com', '四郎', '伊藤', '経理')
    ]);
  });

  test('氏名にスペースがなければ、LastName に氏名全体を入れ、FirstName は空にする', () => {
    const { spreadsheet, gas } = setup({
      [GROUP_LIST]: groupList('経理'),
      '経理': ledger(['ジョン', 'john@example.com', true])
    });

    gas.createMaintenanceSheet();

    assert.deepEqual(spreadsheet.valuesOf(CSV), [
      CSV_HEADER,
      csvRow('john@example.com', '', 'ジョン', '経理')
    ]);
  });

  test('既存の「メンテナンス用CSV」は、古い内容を残さずに書き直す', () => {
    const oldValues = Array.from({ length: 10 }, (_, r) => Array.from({ length: 10 }, (_, c) => `古い${r}-${c}`));
    const { spreadsheet, gas } = setup({
      [GROUP_LIST]: groupList('経理'),
      '経理': ledger(['吉田 翔', 'yoshida@example.com', true]),
      [CSV]: oldValues
    });

    gas.createMaintenanceSheet();

    assert.deepEqual(spreadsheet.valuesOf(CSV), [
      CSV_HEADER,
      csvRow('yoshida@example.com', '翔', '吉田', '経理')
    ]);
    assert.equal(spreadsheet.sheetNames().filter(name => name === CSV).length, 1);
  });

  test('「メンテナンス用CSV」シートがなければ追加する', () => {
    const { spreadsheet, gas } = setup({
      [GROUP_LIST]: groupList('経理'),
      '経理': ledger(['吉田 翔', 'yoshida@example.com', true])
    });
    assert.equal(spreadsheet.valuesOf(CSV), undefined);

    gas.createMaintenanceSheet();

    assert.ok(spreadsheet.sheetNames().includes(CSV));
    assert.deepEqual(spreadsheet.valuesOf(CSV), [
      CSV_HEADER,
      csvRow('yoshida@example.com', '翔', '吉田', '経理')
    ]);
  });

  test('対象の行が 1 つもなければ、見出しだけを出力する', () => {
    const { spreadsheet, gas } = setup({
      [GROUP_LIST]: groupList('経理'),
      '経理': ledger(['佐藤 一郎', 'sato@example.com', false])
    });

    gas.createMaintenanceSheet();

    assert.deepEqual(spreadsheet.valuesOf(CSV), [CSV_HEADER]);
  });

  describe('E 列のシートが見つからないとき', () => {
    const sheetsWithMissingLedger = () => ({
      [GROUP_LIST]: groupList('経理', '存在しない台帳'),
      '経理': ledger(['吉田 翔', 'yoshida@example.com', true])
    });

    test('シート名を含むエラーで止まり、既存の「メンテナンス用CSV」は書き換えない', () => {
      const oldValues = [['古い内容', 'そのまま']];
      const { spreadsheet, gas } = setup({ ...sheetsWithMissingLedger(), [CSV]: oldValues });

      assert.throws(() => gas.createMaintenanceSheet(), /存在しない台帳/);
      assert.deepEqual(spreadsheet.valuesOf(CSV), oldValues);
    });

    test('「メンテナンス用CSV」シートがなければ、追加もしない', () => {
      const { spreadsheet, gas } = setup(sheetsWithMissingLedger());

      assert.throws(() => gas.createMaintenanceSheet(), /存在しない台帳/);
      assert.equal(spreadsheet.sheetNames().includes(CSV), false);
    });
  });
});
