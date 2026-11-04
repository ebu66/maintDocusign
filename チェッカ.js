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

function writeCheckResult_(ss, startTime, endTime, diffs, errors) {
  let sheet = ss.getSheetByName(CHECKER_RESULT_SHEET_NAME);
  if (sheet) {
    sheet.clear();
  } else {
    sheet = ss.insertSheet(CHECKER_RESULT_SHEET_NAME);
  }

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
