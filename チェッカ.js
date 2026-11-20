// ==========================================
// Google グループと台帳の差分チェック（仕様は spec.md を参照）
// ==========================================
const CHECKER_SPREADSHEET_ID = '196SPVP3fcAWrnv6fJAlFRAlxRNGECa-YxSIzX1uUOfo';
const CHECKER_GROUP_LIST_SHEET_NAME = '共有事務グループ一覧';
const CHECKER_RESULT_SHEET_NAME = '検査結果';
const CHECKER_DIFF_LEDGER_ONLY = '台帳のみにあり';
const CHECKER_DIFF_GROUP_ONLY = 'Googleグループのみにあり';
const CHECKER_NOTIFY_TO = 't-egusa@odk.co.jp';
const CHECKER_SUBJECT_DIFF = 'Docusign：差分あり、台帳/GWS比較';
const CHECKER_SUBJECT_NO_DIFF = 'Docusign：差分なし、台帳/GWS比較';
const CHECKER_SUBJECT_ERROR = 'Docusign：エラーあり、台帳/GWS比較';

function checkGroupMembers() {
  const startTime = new Date();
  const ss = SpreadsheetApp.openById(CHECKER_SPREADSHEET_ID);
  const diffs = [];
  const errors = [];

  readGroupList_(ss).forEach(group => {
    try {
      const ledger = readLedger_(ss, group.ledgerSheetName);
      const members = listGroupMembers_(group.email);

      ledger.forEach((name, email) => {
        if (!members.has(email)) {
          diffs.push([group.name, group.email, email, name, CHECKER_DIFF_LEDGER_ONLY]);
        }
      });
      members.forEach((type, email) => {
        if (!ledger.has(email)) {
          diffs.push([group.name, group.email, email, getMemberDisplayName_(email, type), CHECKER_DIFF_GROUP_ONLY]);
        }
      });
    } catch (e) {
      // 1 グループの失敗でチェック全体を止めず、結果シートにエラーとして残す
      console.error(`${group.name}（${group.email}）: ${e.message}`);
      errors.push([group.name, group.email, '', '', `エラー: ${e.message}`]);
    }
  });

  const endTime = new Date();
  const resultSheet = writeCheckResult_(ss, startTime, endTime, diffs, errors);
  notifyCheckResult_(ss, resultSheet, diffs.length, errors.length);
}

// 共有事務グループ一覧から、C列 = グループ名称、D列 = グループのメールアドレス、E列 = 台帳シート名 を読む
function readGroupList_(ss) {
  const sheet = ss.getSheetByName(CHECKER_GROUP_LIST_SHEET_NAME);
  if (!sheet) {
    throw new Error(`シート「${CHECKER_GROUP_LIST_SHEET_NAME}」が見つかりません`);
  }
  return sheet.getDataRange().getValues()
    .map(row => ({
      name: String(row[2]).trim(),
      email: normalizeEmail_(row[3]),
      ledgerSheetName: String(row[4]).trim()
    }))
    .filter(group => group.email.includes('@')); // 見出し行や空行を除く
}

// 台帳シート（A列 = 氏名、B列 = メールアドレス）を メールアドレス → 氏名 の Map にする
function readLedger_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`台帳シート「${sheetName}」が見つかりません`);
  }
  const ledger = new Map();
  sheet.getDataRange().getValues().forEach(row => {
    const email = normalizeEmail_(row[1]);
    if (email.includes('@')) { // 見出し行（氏名）や空行を除く
      ledger.set(email, String(row[0]).trim());
    }
  });
  return ledger;
}

// Google グループの直接のメンバーを メールアドレス → メンバー種別（USER / GROUP / EXTERNAL など）の Map にする
function listGroupMembers_(groupEmail) {
  const members = new Map();
  let pageToken;
  do {
    const page = AdminDirectory.Members.list(groupEmail, { maxResults: 200, pageToken: pageToken });
    (page.members || []).forEach(member => {
      // 種別 CUSTOMER（ドメイン全体）のメンバーにはメールアドレスがない
      if (member.email) {
        members.set(normalizeEmail_(member.email), member.type);
      }
    });
    pageToken = page.nextPageToken;
  } while (pageToken);
  return members;
}

function getMemberDisplayName_(email, type) {
  try {
    if (type === 'USER') {
      return AdminDirectory.Users.get(email).name.fullName;
    }
    if (type === 'GROUP') {
      return AdminDirectory.Groups.get(email).name;
    }
  } catch (e) {
    // ドメイン外のユーザーなどは取得できないので、表示名は空欄にする
    console.warn(`${email} の表示名を取得できません: ${e.message}`);
  }
  return '';
}

function normalizeEmail_(value) {
  return String(value).trim().toLowerCase();
}

// 結果出力用のシートを、既にあればクリアし、なければ追加して返す
function prepareResultSheet_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (sheet) {
    sheet.clear();
    return sheet;
  }
  return ss.insertSheet(sheetName);
}

function writeCheckResult_(ss, startTime, endTime, diffs, errors) {
  const sheet = prepareResultSheet_(ss, CHECKER_RESULT_SHEET_NAME);

  const summary = [
    ['チェック開始時刻', startTime],
    ['チェック終了時刻', endTime],
    ['差分件数', diffs.length],
    ['エラー件数', errors.length]
  ];
  sheet.getRange(1, 1, summary.length, 2).setValues(summary);
  sheet.getRange(1, 2, 2, 1).setNumberFormat('yyyy/MM/dd HH:mm:ss');

  const table = [['グループ名称', 'グループのメールアドレス', 'メールアドレス', '表示名', '差分の内容']].concat(diffs, errors);
  sheet.getRange(summary.length + 2, 1, table.length, table[0].length).setValues(table);
  return sheet;
}

function notifyCheckResult_(ss, resultSheet, diffCount, errorCount) {
  const url = `${ss.getUrl()}#gid=${resultSheet.getSheetId()}`;
  const lines = diffCount > 0
    ? [`台帳と GWS の Google グループを比較した結果、差分が ${diffCount} 件ありました。`]
    : ['台帳と GWS の Google グループを比較した結果、差分はありませんでした。'];
  if (errorCount > 0) {
    lines.push(`チェックできなかったグループが ${errorCount} 件あります。`);
  }
  lines.push('', '検査結果シート:', url);

  let subject = CHECKER_SUBJECT_NO_DIFF;
  if (diffCount > 0) {
    subject = CHECKER_SUBJECT_DIFF;
  } else if (errorCount > 0) {
    subject = CHECKER_SUBJECT_ERROR;
  }
  MailApp.sendEmail(CHECKER_NOTIFY_TO, subject, lines.join('\n'));
}

// ==========================================
// 台帳のメールアドレスの Docusign 登録確認（仕様は spec.md を参照）
// ==========================================
const CHECKER_DOCUSIGN_RESULT_SHEET_NAME = 'Docusign確認結果';
const CHECKER_DOCUSIGN_AUTH_SERVER = 'account.docusign.com'; // 本番環境（デモ環境は account-d.docusign.com）
const CHECKER_DOCUSIGN_API_BASE_URL = 'https://na4.docusign.net/restapi/v2.1';
const CHECKER_DOCUSIGN_USER_STATUSES = 'Active,ActivationSent,ActivationRequired,Closed,Disabled';

function checkDocusignUsers() {
  const startTime = new Date();
  const ss = SpreadsheetApp.openById(CHECKER_SPREADSHEET_ID);
  const docusignUsers = listDocusignUsers_(getDocusignAccessToken_());
  const ledgerEmails = new Set();
  const rows = [];
  const errors = [];
  let notFoundCount = 0;

  readGroupList_(ss).forEach(group => {
    try {
      readLedger_(ss, group.ledgerSheetName).forEach((name, email) => {
        ledgerEmails.add(email);
        const user = docusignUsers.get(email);
        if (!user) {
          notFoundCount++;
        }
        rows.push([group.name, name, email, 'あり', user ? 'あり' : 'なし', user ? user.statuses.join(', ') : '']);
      });
    } catch (e) {
      // 1 グループの失敗でチェック全体を止めず、結果シートにエラーとして残す
      console.error(`${group.name}（${group.email}）: ${e.message}`);
      errors.push([group.name, '', '', 'エラー', '', e.message]);
    }
  });

  // Docusign にあって、どの台帳にもないユーザー
  const docusignOnlyRows = [];
  docusignUsers.forEach((user, email) => {
    if (!ledgerEmails.has(email)) {
      docusignOnlyRows.push(['', user.name, email, 'なし', 'あり', user.statuses.join(', ')]);
    }
  });
  docusignOnlyRows.sort((a, b) => a[2].localeCompare(b[2]));

  const endTime = new Date();
  writeDocusignCheckResult_(ss, startTime, endTime, rows, notFoundCount, docusignOnlyRows, errors);
}

// Docusign アカウントの全ユーザーを取得し、メールアドレス → { name: ユーザー名, statuses: ステータスの配列 } の Map にする
// （同じメールアドレスで複数のユーザーが登録されていることがあるため、ステータスは配列で持つ）
function listDocusignUsers_(accessToken) {
  const accountId = PropertiesService.getScriptProperties().getProperty('DS_ACCOUNT_ID');
  const docusignUsers = new Map();
  let startPosition = 0;
  let hasMore = true;
  while (hasMore) {
    const url = `${CHECKER_DOCUSIGN_API_BASE_URL}/accounts/${accountId}/users`
      + `?status=${CHECKER_DOCUSIGN_USER_STATUSES}&count=100&start_position=${startPosition}`;
    const response = UrlFetchApp.fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      throw new Error('Docusign のユーザー一覧の取得に失敗しました: ' + response.getContentText());
    }
    const data = JSON.parse(response.getContentText());
    const pageUsers = data.users || [];
    pageUsers.forEach(user => {
      if (!user.email) {
        return;
      }
      const email = normalizeEmail_(user.email);
      const entry = docusignUsers.get(email) || { name: user.userName || '', statuses: [] };
      if (!entry.statuses.includes(user.userStatus)) {
        entry.statuses.push(user.userStatus);
      }
      docusignUsers.set(email, entry);
    });
    startPosition += pageUsers.length;
    hasMore = pageUsers.length > 0 && startPosition < Number(data.totalSetSize);
  }
  return docusignUsers;
}

// 指定したメールアドレスの Docusign ユーザー ID を返す。該当するユーザーがいない場合は "Not Found" を返す
// （コード.js の getAllSheet から呼ばれる。aaa.js から移動）
function getDocusignUserId(email) {
  if (!email) {
    return undefined;
  }
  const accessToken = getDocusignAccessToken_();
  const accountId = PropertiesService.getScriptProperties().getProperty('DS_ACCOUNT_ID');
  const url = `${CHECKER_DOCUSIGN_API_BASE_URL}/accounts/${accountId}/users`
    + `?email=${encodeURIComponent(email)}&status=${CHECKER_DOCUSIGN_USER_STATUSES}`;
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    muteHttpExceptions: true
  });
  const data = JSON.parse(response.getContentText());
  return data.users && data.users.length > 0 ? data.users[0].userId : 'Not Found';
}

// JWT Grant 認証で Docusign のアクセストークンを取得する（aaa.js の getDocusignAccessToken から移植）
function getDocusignAccessToken_() {
  const props = PropertiesService.getScriptProperties();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: props.getProperty('DS_CLIENT_ID'),
    sub: props.getProperty('DS_USER_ID'),
    iat: now,
    exp: now + 3600, // トークンの有効期限（1時間）
    aud: CHECKER_DOCUSIGN_AUTH_SERVER,
    scope: 'signature impersonation'
  };

  const encode = obj => Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, '');
  const toSign = `${encode(header)}.${encode(payload)}`;
  const privateKey = convertPkcs1ToPkcs8_(props.getProperty('DS_PRIVATE_KEY'));
  const signature = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(toSign, privateKey)).replace(/=+$/, '');

  const response = UrlFetchApp.fetch(`https://${CHECKER_DOCUSIGN_AUTH_SERVER}/oauth/token`, {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${toSign}.${signature}`
    },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('Docusign のアクセストークンの取得に失敗しました: ' + response.getContentText());
  }
  return JSON.parse(response.getContentText()).access_token;
}

// GAS の computeRsaSha256Signature は PKCS#8 形式の鍵しか受け付けないため、
// Docusign が発行する PKCS#1 形式（BEGIN RSA PRIVATE KEY）の鍵を PKCS#8 に変換する（aaa.js の convertPkcs1ToPkcs8 から移植）
function convertPkcs1ToPkcs8_(pkcs1Pem) {
  // 改行コードや余計なスペースをトリミング
  const cleanInput = pkcs1Pem
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
    .join('\n');

  // すでにPKCS#8（RSAの文字がない）形式なら、改行コードの整形だけしてそのまま返す
  if (cleanInput.includes('-----BEGIN PRIVATE KEY-----')) {
    return cleanInput;
  }

  const base64 = cleanInput
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
    .replace(/-----END RSA PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');

  const pkcs1Bytes = Utilities.base64Decode(base64);
  const l1 = pkcs1Bytes.length;
  const l2 = l1 + 22;

  // PKCS#8 ASN.1 DER ヘッダーの構築
  const header = [
    0x30, 0x82, (l2 >> 8) & 0xff, l2 & 0xff,
    0x02, 0x01, 0x00,
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
    0x04, 0x82, (l1 >> 8) & 0xff, l1 & 0xff
  ];

  const pkcs8Bytes = [];
  for (let i = 0; i < header.length; i++) {
    let b = header[i];
    if (b > 127) b -= 256;
    pkcs8Bytes.push(b);
  }
  for (let i = 0; i < pkcs1Bytes.length; i++) {
    pkcs8Bytes.push(pkcs1Bytes[i]);
  }

  const pkcs8Base64 = Utilities.base64Encode(pkcs8Bytes);
  return `-----BEGIN PRIVATE KEY-----\n${pkcs8Base64}\n-----END PRIVATE KEY-----`;
}

function writeDocusignCheckResult_(ss, startTime, endTime, rows, notFoundCount, docusignOnlyRows, errors) {
  const sheet = prepareResultSheet_(ss, CHECKER_DOCUSIGN_RESULT_SHEET_NAME);

  const summary = [
    ['チェック開始時刻', startTime],
    ['チェック終了時刻', endTime],
    ['確認件数', rows.length],
    ['Docusign未登録件数', notFoundCount],
    ['台帳未記載件数', docusignOnlyRows.length],
    ['エラー件数', errors.length]
  ];
  sheet.getRange(1, 1, summary.length, 2).setValues(summary);
  sheet.getRange(1, 2, 2, 1).setNumberFormat('yyyy/MM/dd HH:mm:ss');

  const table = [['グループ名称', '氏名', 'メールアドレス', '台帳', 'Docusign登録', 'Docusignステータス']].concat(rows, docusignOnlyRows, errors);
  sheet.getRange(summary.length + 2, 1, table.length, table[0].length).setValues(table);
}
