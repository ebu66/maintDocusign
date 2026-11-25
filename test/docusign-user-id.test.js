'use strict';
// getDocusignUserId_（spec.md の「getDocusignUserId_」）のテスト。
// UrlFetchApp を偽物に差し替え、Docusign の応答を決めて動かす。本物の Docusign には触れない。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakeUrlFetchApp, createFakeUtilities, loadChecker } = require('./helpers/gas');

const TOKEN_URL = 'https://account.docusign.com/oauth/token';
const USERS_URL = 'https://na4.docusign.net/restapi/v2.1/accounts/test-account/users';
const PROPERTIES = {
  DS_CLIENT_ID: 'test-client',
  DS_USER_ID: 'test-user',
  DS_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----', // PKCS#8 形式なら変換しない
  DS_ACCOUNT_ID: 'test-account'
};

// usersResponse：ユーザー検索に対する応答 { status, body }。トークンの取得には常に成功する
function setup(usersResponse) {
  let tokenCount = 0;
  const urlFetchApp = createFakeUrlFetchApp(url => {
    if (url === TOKEN_URL) {
      tokenCount++;
      return { status: 200, body: { access_token: `token-${tokenCount}`, token_type: 'Bearer', expires_in: 3600 } };
    }
    if (url.startsWith(`${USERS_URL}?`)) {
      return usersResponse;
    }
    throw new Error(`想定していない URL です: ${url}`);
  });
  const gas = loadChecker({
    properties: PROPERTIES,
    services: { UrlFetchApp: urlFetchApp, Utilities: createFakeUtilities() }
  });
  const callsTo = prefix => urlFetchApp.calls.filter(call => call.url.startsWith(prefix));
  return { gas, callsTo };
}

test('ユーザーが見つかれば、最初のユーザーの userId を返す', () => {
  const { gas, callsTo } = setup({
    status: 200,
    body: { users: [{ userId: 'user-1', email: 'yoshida@example.com' }, { userId: 'user-2', email: 'yoshida@example.com' }], resultSetSize: '2' }
  });

  assert.equal(gas.getDocusignUserId_('yoshida@example.com'), 'user-1');

  const [search] = callsTo(USERS_URL);
  assert.ok(search.url.includes(`email=${encodeURIComponent('yoshida@example.com')}`));
  assert.equal(search.options.headers.Authorization, 'Bearer token-1');
});

// 実機では、該当するユーザーがいないと HTTP 400 と errorCode USER_NOT_FOUND が返る
test('該当するユーザーがいない（HTTP 400、USER_NOT_FOUND）なら "Not Found" を返す', () => {
  const { gas } = setup({ status: 400, body: { errorCode: 'USER_NOT_FOUND', message: 'The user was not found.' } });

  assert.equal(gas.getDocusignUserId_('nobody@example.com'), 'Not Found');
});

test('HTTP 400 でも errorCode が USER_NOT_FOUND 以外なら、"Not Found" にせずエラーにする', () => {
  const { gas } = setup({ status: 400, body: { errorCode: 'INVALID_REQUEST_PARAMETER', message: 'The request contained at least one invalid parameter.' } });

  assert.throws(() => gas.getDocusignUserId_('yoshida@example.com'), error => {
    assert.match(error.message, /HTTP 400/);
    assert.match(error.message, /INVALID_REQUEST_PARAMETER/);
    return true;
  });
});

test('HTTP 400 で本文が JSON でなければ、"Not Found" にせずエラーにする', () => {
  const { gas } = setup({ status: 400, body: '<html>Bad Request</html>' });

  assert.throws(() => gas.getDocusignUserId_('yoshida@example.com'), /HTTP 400/);
});

test('HTTP 200 で 0 件（users がない）なら "Not Found" を返す', () => {
  const { gas } = setup({ status: 200, body: { resultSetSize: '0', totalSetSize: '0', startPosition: '0', endPosition: '-1' } });

  assert.equal(gas.getDocusignUserId_('nobody@example.com'), 'Not Found');
});

test('HTTP 200 で users が空の配列でも "Not Found" を返す', () => {
  const { gas } = setup({ status: 200, body: { users: [], resultSetSize: '0' } });

  assert.equal(gas.getDocusignUserId_('nobody@example.com'), 'Not Found');
});

test('メールアドレスが空なら undefined を返し、Docusign を呼ばない', () => {
  const { gas, callsTo } = setup({ status: 200, body: { users: [{ userId: 'user-1' }] } });

  assert.equal(gas.getDocusignUserId_(''), undefined);
  assert.equal(callsTo('https://').length, 0);
});

test('応答が 200 以外なら、"Not Found" にせず、ステータスと本文を含むエラーにする', () => {
  const { gas } = setup({ status: 401, body: { errorCode: 'AUTHORIZATION_INVALID_TOKEN', message: 'The access token provided is expired.' } });

  assert.throws(() => gas.getDocusignUserId_('yoshida@example.com'), error => {
    assert.match(error.message, /HTTP 401/);
    assert.match(error.message, /AUTHORIZATION_INVALID_TOKEN/);
    return true;
  });
});

test('応答が JSON でないエラーページでも、"Not Found" にせず、ステータスを含むエラーにする', () => {
  const { gas } = setup({ status: 503, body: '<html>Service Unavailable</html>' });

  assert.throws(() => gas.getDocusignUserId_('yoshida@example.com'), /HTTP 503/);
});

test('アクセストークンは、1 回の実行の中で 1 度だけ取得して使い回す', () => {
  const { gas, callsTo } = setup({ status: 200, body: { users: [{ userId: 'user-1' }] } });

  gas.getDocusignUserId_('a@example.com');
  gas.getDocusignUserId_('b@example.com');
  gas.getDocusignUserId_('c@example.com');

  assert.equal(callsTo(TOKEN_URL).length, 1);
  const searches = callsTo(USERS_URL);
  assert.equal(searches.length, 3);
  searches.forEach(search => assert.equal(search.options.headers.Authorization, 'Bearer token-1'));
});
