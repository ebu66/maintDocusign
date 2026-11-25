// 実機テスト用。getDocusignUserId_ を下のメールアドレスで 1 件ずつ呼び、結果を実行ログに出す。
// Apps Script エディタで testGetDocusignUserId を選んで実行する（本番の Docusign を呼ぶ。読み取りだけで、何も変更しない）。

// 確かめたいメールアドレス。書き換えて使う
const TEST_DOCUSIGN_USER_EMAILS = [
  'registered@example.com', // ← Docusign に登録済みのメールアドレスに書き換える（ユーザー ID が出るはず）
  'not-registered@example.com', // 登録されていないメールアドレス（"Not Found" が出るはず）
  '' // 空（undefined が出るはず）
];

function testGetDocusignUserId() {
  TEST_DOCUSIGN_USER_EMAILS.forEach(email => {
    try {
      console.log(`「${email}」: ${getDocusignUserId_(email)}`);
    } catch (e) {
      // 1 件の失敗で止めず、残りのメールアドレスも確かめる
      console.error(`「${email}」: ${e.message}`);
    }
  });
}
