function main() {
  // ①自動でアクセストークンを取得
  const accessToken = getDocusignAccessToken();
  Logger.log("自動トークン取得成功");

  // ②取得したトークンを使ってAPIを実行（例：ユーザー情報の取得）
  const userId = getDocusignUserInfo(accessToken);
  console.log(userId);
}

function getDocusignUserId(mailAddresses) {
  // ①自動でアクセストークンを取得
  const accessToken = getDocusignAccessToken();
  //Logger.log("自動トークン取得成功");

  // ②取得したトークンを使ってAPIを実行（例：ユーザー情報の取得）
  if (mailAddresses.length >0) {
    return getDocusignUserInfo(accessToken, mailAddresses);
  }
}

// ==========================================
// 1. JWT認証でアクセストークンを自動取得する関数
// ==========================================
function getDocusignAccessToken() {
  // ▼▼▼ 設定情報 ▼▼▼
  const scriptProperties = PropertiesService.getScriptProperties();
  const CLIENT_ID  = scriptProperties.getProperty('DS_CLIENT_ID');
  const USER_ID    = scriptProperties.getProperty('DS_USER_ID');
  const PRIVATE_KEY = scriptProperties.getProperty('DS_PRIVATE_KEY');
  const AUTH_SERVER = 'account.docusign.com'; // 開発環境
  // ▲▲▲ 設定情報ここまで ▲▲▲

  // ==========================================
  // 【超重要】貼り付けたキーをGASが認識できる綺麗なフォーマットに自動整形します
  // ==========================================
  const cleanPrivateKey = convertPkcs1ToPkcs8(PRIVATE_KEY);
  
  // JWTのヘッダーとペイロードを作成
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: CLIENT_ID,
    sub: USER_ID,
    iat: now,
    exp: now + 3600, // トークンの有効期限（1時間）
    aud: AUTH_SERVER,
    scope: 'signature impersonation'
  };

  // Base64エンコード
  const encode = (obj) => Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, '');
  const encodedHeader = encode(header);
  const encodedPayload = encode(payload);
  const toSign = `${encodedHeader}.${encodedPayload}`;

  // プライベートキーで署名（暗号化）
  const signature = Utilities.computeRsaSha256Signature(toSign, cleanPrivateKey);
  const encodedSignature = Utilities.base64EncodeWebSafe(signature).replace(/=+$/, '');
  const jwt = `${toSign}.${encodedSignature}`;

  // Docusignにトークンを要求
  const options = {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(`https://${AUTH_SERVER}/oauth/token`, options);
  const data = JSON.parse(response.getContentText());

  if (response.getResponseCode() === 200 && data.access_token) {
    return data.access_token;
  } else {
    throw new Error('トークンの自動取得に失敗しました: ' + response.getContentText());
  }
}

// ==========================================
// 2. ユーザー情報を取得する関数（引数にトークンを受け取る）
// ==========================================
function getDocusignUserInfo(accessToken, email) {
  const scriptProperties = PropertiesService.getScriptProperties();
  const ACCOUNT_ID = scriptProperties.getProperty('DS_ACCOUNT_ID');

  const url = `https://na4.docusign.net/restapi/v2.1/accounts/${ACCOUNT_ID}/users?email=${encodeURIComponent(email)}&status=Active,ActivationSent,ActivationRequired,Closed,Disabled`;

  const options = {
    method: 'get',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseData = JSON.parse(response.getContentText());
  Logger.log(responseData);
  if (responseData.users && responseData.users.length > 0) {
    return responseData.users[0].userId;
  } else {
    return "Not Found";

  }
}

// ==========================================
// 3. PKCS#1をPKCS#8に自動変換するユーティリティ関数
// ==========================================
function convertPkcs1ToPkcs8(pkcs1Pem) {
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

function test1() {
  const emails = ['takigawa@odk.co.jp', 'a-kaneuchi@odk.co.jp', 'a-karuo@odk.co.jp']
  emails.forEach((email, index)=>{
    Logger.log(getDocusignUserId(email));
  });
}
