'use strict';
// メンテナンス用シートの生成（spec.md の「メンテナンス用シートの生成」）のテスト。
// Docusign のユーザー一覧 API は偽物に差し替える。MailApp・AdminDirectory は触れると例外になるので、
// どのテストも「Docusign 以外の外部サービスを呼ばないこと」をあわせて確かめている。

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSpreadsheet, createFakeUrlFetchApp, createFakeUtilities, loadChecker } = require('./helpers/gas');

const GROUP_LIST = '共有事務グループ一覧';
const CSV = 'メンテナンス用CSV';
const CSV_HEADER = ['UserEmail', 'APIUserName', 'FirstName', 'LastName', 'PermissionSet', 'CompanyName', 'Group', 'Language'];
const LEDGER_HEADER = ['氏名', 'メールアドレス', '更新対象'];

const TOKEN_URL = 'https://account.docusign.com/oauth/token';
const USERS_URL = 'https://na4.docusign.net/restapi/v2.1/accounts/test-account/users';
const PROPERTIES = {
  DS_CLIENT_ID: 'test-client',
  DS_USER_ID: 'test-user',
  DS_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----', // PKCS#8 形式なら変換しない
  DS_ACCOUNT_ID: 'test-account'
};

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

// 特に指定しないテストで使う、Docusign のユーザー ID
const idOf = email => `id-${email}`;

// メンテナンス用CSV の 1 行。userId を省くと idOf(email) になる
function csvRow(email, firstName, lastName, group, userId = idOf(email)) {
  return [email, userId, firstName, lastName, 'DS Sender', '株式会社ODKソリューションズ', group, 'ja'];
}

// Docusign のユーザー一覧 API が返すユーザー 1 人分
function docusignUser(email, userId, userStatus = 'Active') {
  return { email, userId, userStatus, userName: email };
}

// 台帳に書かれたメールアドレスの全員が、Docusign に Active で 1 人ずついる状態（ID は idOf）
function everyoneActive(sheets) {
  const emails = new Set();
  Object.entries(sheets)
    .filter(([name]) => name !== GROUP_LIST && name !== CSV)
    .forEach(([, values]) => values.forEach(row => {
      const email = String(row[1]).trim();
      if (email.includes('@')) {
        emails.add(email);
      }
    }));
  return [...emails].map(email => docusignUser(email, idOf(email)));
}

// Docusign の偽物。トークンの取得と、ユーザー一覧（start_position と count でページを切り出す）に答える
function fakeDocusign(users) {
  return createFakeUrlFetchApp(url => {
    if (url === TOKEN_URL) {
      return { status: 200, body: { access_token: 'token-1', token_type: 'Bearer', expires_in: 3600 } };
    }
    if (url.startsWith(`${USERS_URL}?`)) {
      const params = new URL(url).searchParams;
      const start = Number(params.get('start_position') || 0);
      const count = Number(params.get('count') || 100);
      const page = users.slice(start, start + count);
      return {
        status: 200,
        body: { users: page, resultSetSize: String(page.length), totalSetSize: String(users.length), startPosition: String(start) }
      };
    }
    throw new Error(`想定していない URL です: ${url}`);
  });
}

// docusignUsers を省くと、台帳の全員が Docusign に Active でいる状態にする。urlFetchApp を渡すとそれを使う
function setup(sheets, { docusignUsers = everyoneActive(sheets), urlFetchApp = fakeDocusign(docusignUsers) } = {}) {
  const spreadsheet = createFakeSpreadsheet(sheets);
  const gas = loadChecker({
    spreadsheet,
    properties: PROPERTIES,
    services: { UrlFetchApp: urlFetchApp, Utilities: createFakeUtilities() }
  });
  return { spreadsheet, gas, urlFetchApp };
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

  test('対象の行が 1 つもなければ、Docusign を呼ばずに見出しだけを出力する', () => {
    const { spreadsheet, gas, urlFetchApp } = setup({
      [GROUP_LIST]: groupList('経理'),
      '経理': ledger(['佐藤 一郎', 'sato@example.com', false])
    });

    gas.createMaintenanceSheet();

    assert.deepEqual(spreadsheet.valuesOf(CSV), [CSV_HEADER]);
    assert.equal(urlFetchApp.calls.length, 0);
  });

  describe('E 列のシートが見つからないとき', () => {
    const sheetsWithMissingLedger = () => ({
      [GROUP_LIST]: groupList('経理', '存在しない台帳'),
      '経理': ledger(['吉田 翔', 'yoshida@example.com', true])
    });

    test('シート名を含むエラーで止まり、既存の「メンテナンス用CSV」は書き換えない', () => {
      const oldValues = [['古い内容', 'そのまま']];
      const { spreadsheet, gas, urlFetchApp } = setup({ ...sheetsWithMissingLedger(), [CSV]: oldValues });

      assert.throws(() => gas.createMaintenanceSheet(), /存在しない台帳/);
      assert.deepEqual(spreadsheet.valuesOf(CSV), oldValues);
      assert.equal(urlFetchApp.calls.length, 0, 'Docusign を呼ぶ前に止まる');
    });

    test('「メンテナンス用CSV」シートがなければ、追加もしない', () => {
      const { spreadsheet, gas } = setup(sheetsWithMissingLedger());

      assert.throws(() => gas.createMaintenanceSheet(), /存在しない台帳/);
      assert.equal(spreadsheet.sheetNames().includes(CSV), false);
    });
  });

  describe('APIUserName（Docusign のユーザー ID）', () => {
    test('Docusign のユーザー一覧から、メールアドレスの一致するユーザーの ID を入れる', () => {
      const { spreadsheet, gas, urlFetchApp } = setup({
        [GROUP_LIST]: groupList('経理'),
        '経理': ledger(['吉田 翔', 'yoshida@example.com', true])
      }, {
        docusignUsers: [docusignUser('other@example.com', 'guid-0'), docusignUser('yoshida@example.com', 'guid-1')]
      });

      gas.createMaintenanceSheet();

      assert.deepEqual(spreadsheet.valuesOf(CSV), [
        CSV_HEADER,
        csvRow('yoshida@example.com', '翔', '吉田', '経理', 'guid-1')
      ]);
      // 1 件ずつ検索せず、一覧を一括で取得している
      const searches = urlFetchApp.calls.filter(call => call.url.startsWith(USERS_URL));
      assert.equal(searches.length, 1);
      assert.ok(!searches[0].url.includes('email='));
    });

    test('Docusign にいない人は出力しない', () => {
      const { spreadsheet, gas } = setup({
        [GROUP_LIST]: groupList('経理'),
        '経理': ledger(
          ['吉田 翔', 'yoshida@example.com', true],
          ['田中 美咲', 'tanaka@example.com', true]
        )
      }, {
        docusignUsers: [docusignUser('tanaka@example.com', 'guid-2')]
      });

      gas.createMaintenanceSheet();

      assert.deepEqual(spreadsheet.valuesOf(CSV), [
        CSV_HEADER,
        csvRow('tanaka@example.com', '美咲', '田中', '経理', 'guid-2')
      ]);
    });

    test('同じメールアドレスに複数のユーザーがいれば、ActivationSent、Active の順に選ぶ', () => {
      const { spreadsheet, gas } = setup({
        [GROUP_LIST]: groupList('経理'),
        '経理': ledger(
          ['吉田 翔', 'yoshida@example.com', true],
          ['田中 美咲', 'tanaka@example.com', true]
        )
      }, {
        docusignUsers: [
          docusignUser('yoshida@example.com', 'active-1', 'Active'),
          docusignUser('yoshida@example.com', 'sent-1', 'ActivationSent'),
          docusignUser('tanaka@example.com', 'closed-2', 'Closed'),
          docusignUser('tanaka@example.com', 'active-2', 'Active')
        ]
      });

      gas.createMaintenanceSheet();

      assert.deepEqual(spreadsheet.valuesOf(CSV), [
        CSV_HEADER,
        csvRow('yoshida@example.com', '翔', '吉田', '経理', 'sent-1'),
        csvRow('tanaka@example.com', '美咲', '田中', '経理', 'active-2')
      ]);
    });

    test('ActivationSent・Active 以外（Closed・ActivationRequired・Disabled）のユーザーしかいない人は出力しない', () => {
      const { spreadsheet, gas } = setup({
        [GROUP_LIST]: groupList('経理'),
        '経理': ledger(
          ['吉田 翔', 'yoshida@example.com', true],
          ['田中 美咲', 'tanaka@example.com', true],
          ['山本 健', 'yamamoto@example.com', true],
          ['伊藤 四郎', 'ito@example.com', true]
        )
      }, {
        docusignUsers: [
          docusignUser('yoshida@example.com', 'closed-1', 'Closed'),
          docusignUser('tanaka@example.com', 'required-2', 'ActivationRequired'),
          docusignUser('yamamoto@example.com', 'disabled-3', 'Disabled'),
          docusignUser('ito@example.com', 'active-4', 'Active')
        ]
      });

      gas.createMaintenanceSheet();

      assert.deepEqual(spreadsheet.valuesOf(CSV), [
        CSV_HEADER,
        csvRow('ito@example.com', '四郎', '伊藤', '経理', 'active-4')
      ]);
    });

    test('同じステータスのユーザーが複数いて ID を決められなければ、エラーで止め、「メンテナンス用CSV」は書き換えない', () => {
      const oldValues = [['古い内容', 'そのまま']];
      const { spreadsheet, gas } = setup({
        [GROUP_LIST]: groupList('経理'),
        '経理': ledger(
          ['田中 美咲', 'tanaka@example.com', true],
          ['吉田 翔', 'yoshida@example.com', true]
        ),
        [CSV]: oldValues
      }, {
        docusignUsers: [
          docusignUser('tanaka@example.com', 'active-2', 'Active'),
          docusignUser('yoshida@example.com', 'active-1a', 'Active'),
          docusignUser('yoshida@example.com', 'active-1b', 'Active')
        ]
      });

      assert.throws(() => gas.createMaintenanceSheet(), /yoshida@example\.com/);
      assert.deepEqual(spreadsheet.valuesOf(CSV), oldValues);
    });

    test('優先するステータスのユーザーが 1 人なら、後ろのステータスのユーザーが複数いても、その人を選ぶ', () => {
      const { spreadsheet, gas } = setup({
        [GROUP_LIST]: groupList('経理'),
        '経理': ledger(['吉田 翔', 'yoshida@example.com', true])
      }, {
        docusignUsers: [
          docusignUser('yoshida@example.com', 'active-1a', 'Active'),
          docusignUser('yoshida@example.com', 'active-1b', 'Active'),
          docusignUser('yoshida@example.com', 'sent-1', 'ActivationSent')
        ]
      });

      gas.createMaintenanceSheet();

      assert.deepEqual(spreadsheet.valuesOf(CSV), [
        CSV_HEADER,
        csvRow('yoshida@example.com', '翔', '吉田', '経理', 'sent-1')
      ]);
    });

    test('メールアドレスは大文字・小文字を区別せずに照合し、UserEmail には台帳の値を出す', () => {
      const { spreadsheet, gas } = setup({
        [GROUP_LIST]: groupList('経理'),
        '経理': ledger(['吉田 翔', 'Yoshida@Example.com', true])
      }, {
        docusignUsers: [docusignUser('yoshida@example.com', 'guid-1')]
      });

      gas.createMaintenanceSheet();

      assert.deepEqual(spreadsheet.valuesOf(CSV), [
        CSV_HEADER,
        csvRow('Yoshida@Example.com', '翔', '吉田', '経理', 'guid-1')
      ]);
    });

    test('Docusign のユーザーが 100 人を超えても、すべてのページから探す', () => {
      const others = Array.from({ length: 150 }, (_, i) => docusignUser(`user${i}@example.com`, `guid-${i}`));
      others.splice(140, 0, docusignUser('yoshida@example.com', 'guid-yoshida'));
      const { spreadsheet, gas, urlFetchApp } = setup({
        [GROUP_LIST]: groupList('経理'),
        '経理': ledger(['吉田 翔', 'yoshida@example.com', true])
      }, {
        docusignUsers: others
      });

      gas.createMaintenanceSheet();

      assert.deepEqual(spreadsheet.valuesOf(CSV), [
        CSV_HEADER,
        csvRow('yoshida@example.com', '翔', '吉田', '経理', 'guid-yoshida')
      ]);
      assert.equal(urlFetchApp.calls.filter(call => call.url.startsWith(USERS_URL)).length, 2);
    });

    test('Docusign のユーザー一覧を取得できなければ、エラーで止め、「メンテナンス用CSV」は書き換えない', () => {
      const oldValues = [['古い内容', 'そのまま']];
      const urlFetchApp = createFakeUrlFetchApp(url => (url === TOKEN_URL
        ? { status: 200, body: { access_token: 'token-1' } }
        : { status: 500, body: { errorCode: 'UNSPECIFIED_ERROR', message: 'An unexpected error occurred.' } }));
      const { spreadsheet, gas } = setup({
        [GROUP_LIST]: groupList('経理'),
        '経理': ledger(['吉田 翔', 'yoshida@example.com', true]),
        [CSV]: oldValues
      }, { urlFetchApp });

      assert.throws(() => gas.createMaintenanceSheet(), /UNSPECIFIED_ERROR/);
      assert.deepEqual(spreadsheet.valuesOf(CSV), oldValues);
    });
  });

  describe('同じメールアドレスが複数の台帳にあるとき', () => {
    test('どの台帳でもチェックが付いていなければ、出力しない', () => {
      const { spreadsheet, gas } = setup({
        [GROUP_LIST]: groupList('経理', '総務'),
        '経理': ledger(
          ['吉田 翔', 'yoshida@example.com', false],
          ['田中 美咲', 'tanaka@example.com', true]
        ),
        '総務': ledger(['吉田 翔', 'yoshida@example.com', false])
      });

      gas.createMaintenanceSheet();

      assert.deepEqual(spreadsheet.valuesOf(CSV), [
        CSV_HEADER,
        csvRow('tanaka@example.com', '美咲', '田中', '経理')
      ]);
    });

    test('すべての台帳でチェックが付いていれば、1 行にまとめ、部署を「,」区切りでつなぐ', () => {
      const { spreadsheet, gas } = setup({
        [GROUP_LIST]: groupList('経理', '総務'),
        '経理': ledger(['吉田 翔', 'yoshida@example.com', true]),
        '総務': ledger(['吉田 翔', 'yoshida@example.com', true])
      });

      gas.createMaintenanceSheet();

      assert.deepEqual(spreadsheet.valuesOf(CSV), [
        CSV_HEADER,
        csvRow('yoshida@example.com', '翔', '吉田', '経理,総務')
      ]);
    });

    test('チェックの有無が混在していれば、チェックのない部署も含めて「,」区切りでつなぐ', () => {
      const { spreadsheet, gas } = setup({
        [GROUP_LIST]: groupList('経理', '総務', '人事'),
        '経理': ledger(['吉田 翔', 'yoshida@example.com', false]),
        '総務': ledger(['吉田 翔', 'yoshida@example.com', true]),
        '人事': ledger(['吉田 翔', 'yoshida@example.com', false])
      });

      gas.createMaintenanceSheet();

      assert.deepEqual(spreadsheet.valuesOf(CSV), [
        CSV_HEADER,
        csvRow('yoshida@example.com', '翔', '吉田', '経理,総務,人事')
      ]);
    });

    test('1 行にまとめた人は、そのメールアドレスが最初に出てくる位置に出力する', () => {
      const { spreadsheet, gas } = setup({
        [GROUP_LIST]: groupList('経理', '総務'),
        '経理': ledger(
          ['吉田 翔', 'yoshida@example.com', false],
          ['田中 美咲', 'tanaka@example.com', true]
        ),
        '総務': ledger(
          ['山本 健', 'yamamoto@example.com', true],
          ['吉田 翔', 'yoshida@example.com', true]
        )
      });

      gas.createMaintenanceSheet();

      assert.deepEqual(spreadsheet.valuesOf(CSV), [
        CSV_HEADER,
        csvRow('yoshida@example.com', '翔', '吉田', '経理,総務'),
        csvRow('tanaka@example.com', '美咲', '田中', '経理'),
        csvRow('yamamoto@example.com', '健', '山本', '総務')
      ]);
    });

    test('大文字・小文字が違っても同じ人としてまとめ、メールアドレスと氏名は最初にチェックが付いた行の値を使う', () => {
      const { spreadsheet, gas } = setup({
        [GROUP_LIST]: groupList('経理', '総務', '人事'),
        '経理': ledger(['吉田 翔', 'Yoshida@Example.com', false]),
        '総務': ledger(['吉田 翔太', 'yoshida@example.com', true]),
        '人事': ledger(['吉田 しょう', 'YOSHIDA@example.com', true])
      }, {
        docusignUsers: [docusignUser('yoshida@example.com', 'guid-1')]
      });

      gas.createMaintenanceSheet();

      assert.deepEqual(spreadsheet.valuesOf(CSV), [
        CSV_HEADER,
        csvRow('yoshida@example.com', '翔太', '吉田', '経理,総務,人事', 'guid-1')
      ]);
    });

    test('同じ台帳に同じメールアドレスが 2 行あっても、部署名は 1 回だけにする', () => {
      const { spreadsheet, gas } = setup({
        [GROUP_LIST]: groupList('経理'),
        '経理': ledger(
          ['吉田 翔', 'yoshida@example.com', true],
          ['吉田 翔', 'yoshida@example.com', false]
        )
      });

      gas.createMaintenanceSheet();

      assert.deepEqual(spreadsheet.valuesOf(CSV), [
        CSV_HEADER,
        csvRow('yoshida@example.com', '翔', '吉田', '経理')
      ]);
    });
  });
});
