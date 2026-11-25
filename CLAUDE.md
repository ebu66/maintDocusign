# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

このファイルは日本語で記載すること。

## 仕様

仕様は [spec.md](spec.md) を参照すること。動作を変えるときは `spec.md` も同じ変更で更新し、コードと仕様を一致させること。

## 概要

Google スプレッドシートにバインドされた Google Apps Script（GAS、V8 ランタイム）のプロジェクト。機能は次の 3 つで、どれも `チェッカ.js` に実装されている。

- **`checkGroupMembers`**：`共有事務グループ一覧` シートに載っているグループごとに、台帳シートのメンバーと GWS 上の Google グループのメンバーを比較する。差分を `検査結果` シートに出力し、結果をメールで通知する。
- **`checkDocusignUsers`**：台帳のメールアドレスが Docusign のユーザーとして登録されているか（登録されていればそのステータス）を確認する。Docusign にあってどの台帳にもないユーザーとあわせて `Docusign確認結果` シートに出力する。メール通知はしない。
- **`createMaintenanceSheet`**：台帳で C 列（更新対象）にチェックが付いたメンバーを、Docusign のユーザー一括更新用の CSV の形式で `メンテナンス用CSV` シートに出力する。目的は既存ユーザーの情報の補完（ユーザーの作成は GWS からのプロビジョニングで行う）。APIUserName には、Docusign の全ユーザーを一括取得して照合したユーザー ID を入れる。スプレッドシートのメニュー（`コード.js` の `onOpen`）から呼ばれる。

<!--
チェックの付いたメンバーの DocuSign ユーザー ID を DocuSign REST API で検索し、DocuSign のユーザーメンテナンス用 CSV データをシートに出力する。
-->
ソースは [clasp](https://github.com/google/clasp)（3.x、グローバルにインストール済みで `package.json` には含まれない）で同期する。

## コマンド

ビルド・リントの仕組みはない。`npm install` で入るのはエディタ補完用の `@types/google-apps-script` だけ（`jsconfig.json`、`checkJs: false`）。テストは Node 標準のテストランナー（`node:test`）で書いており、依存パッケージはない。

```sh
npm test              # test/ のテストを実行する（ローカルだけで動き、本番には触れない）
clasp status          # push でアップロードされるファイルを一覧表示（ルート直下の .js/.gs と appsscript.json）
clasp push            # ローカルのファイルでリモートのプロジェクトを上書きする
clasp pull            # リモートのプロジェクトを取得する。オンラインエディタでコードが変更された可能性があれば、編集前に実行する
clasp open-script     # Apps Script エディタを開く
clasp open-container  # バインド先のスプレッドシートを開く
```

- テストは、`test/helpers/gas.js` が `チェッカ.js` を Node の `vm` に読み込み、`SpreadsheetApp` を偽のスプレッドシートに差し替えて動かす。`UrlFetchApp`・`MailApp`・`AdminDirectory`・`Utilities` は、既定では触ると例外になる偽物なので、外部サービスを呼ばないことも確かめられる。Docusign を呼ぶ処理は、`loadChecker` の `services` で `createFakeUrlFetchApp`（応答を決められる偽物）と `createFakeUtilities` に差し替えてテストする（`test/docusign-user-id.test.js` が例）。
- `test/` は `.claspignore` で push 対象から外している。`.claspignore` を置くと clasp の既定の除外リストが置き換わるため、既定の内容（`appsscript.json` と `.gs`/`.js`/`.ts`/`.html` 以外、`.git/`、`node_modules/` を除外）も写してある。push したくないフォルダを増やしたら、ここに足すこと。
- `.clasp.json`（スクリプト ID、`rootDir: ""`）は gitignore 対象だが、clasp の動作に必要。
- push 先は `.clasp.json` のスクリプト 1 つだけで、テスト用のプロジェクトはない。push した内容はそのまま本番で動く。
- 関数は Apps Script エディタかスプレッドシートのメニューから実行する。`clasp run` は GCP や API 実行可能ファイルの追加設定をしないと使えない。ローカルでは `npm test` の偽 GAS でしか動かせない。
- 本番での動作確認は、`npm test` のあと、エディタかメニューで対象の関数を実行し、実行ログと出力先のシートを見る。どれも本番のスプレッドシート（`CHECKER_SPREADSHEET_ID`）に書き込む。`checkDocusignUsers` は本番の Docusign を呼び、`checkGroupMembers` は実行するたびに `CHECKER_NOTIFY_TO` 宛てに実際にメールを送る。
- `test.gs` は実機テスト用のファイルで、push される（ローカルのテストの `test/` とは別物）。エディタで `testGetDocusignUserId` を実行すると、ファイル内の配列 `TEST_DOCUSIGN_USER_EMAILS` のメールアドレスで `getDocusignUserId_` を 1 件ずつ呼び、結果を実行ログに出す。本番の Docusign を読むだけで、何も変更しない。
- `clasp pull` は、リモートのスクリプトをすべて `.js`（`.clasp.json` の `scriptExtensions` の先頭）で書き出す。そのため pull すると `test.gs` とは別に `test.js` ができ、両方あると次の `clasp push` が「Conflicting files found」で失敗する。pull したら `test.js` を消すこと。

## アーキテクチャ

使用する `.js` ファイルは `チェッカ.js` のみとする。他の `.js` ファイルは現時点では無視する。
ただし `コード.js` の `onOpen` が、メニュー「⚙️ Docusign管理 → メンテナンス用データ作成」から `チェッカ.js` の `createMaintenanceSheet` を呼ぶので、この関数名は変えないこと。
内部関数 `getDocusignUserId_` は今はどこからも呼ばれていないが、今後使うので削除しないこと。

**GAS のグローバルスコープ。** すべての `.js` ファイルが 1 つのグローバル名前空間を共有する。import/export はなく、関数はファイルをまたいで呼び出される。`コード.js` と `test.gs` も push されるので、その関数名（`onOpen`、`putCSV`、`testGetDocusignUserId`）や定数名（`TEST_DOCUSIGN_USER_EMAILS`）と同じ名前を `チェッカ.js` で定義しないこと。
ファイル名（`コード.js`、`チェッカ.js`）は日本語版 Apps Script エディタの既定名に由来する。ファイル名を変えるとリモートのプロジェクトも変わるので、変更しないこと。

**メイン処理（`チェッカ.js`）。**
詳細仕様は `spec.md` を参照すること。Google グループとの比較、Docusign 確認、メンテナンス用シートの生成の 3 つの節に分かれ、それぞれの先頭に `CHECKER_` で始まる定数をまとめている。

- 外から呼ぶ入口は `checkGroupMembers`、`checkDocusignUsers`、`createMaintenanceSheet` だけ。それ以外の関数名は `_` で終える（GAS では `_` で終わる関数はエディタの実行メニューに出ない private 関数になる）。
- 複数の機能で共有する関数：
  - `readGroupList_`：`共有事務グループ一覧` の C/D/E 列 → グループ名称・グループのメールアドレス・台帳シート名
  - `readLedger_`：台帳シートの A/B 列 → メールアドレス → 氏名 の `Map`
  - `normalizeEmail_`：trim と小文字化。メールアドレスの比較・`Map` のキーは必ずこれを通す
  - `prepareResultSheet_`：結果シートがあればクリアし、なければ追加する
  - `listDocusignUsers_`：Docusign の全ユーザー → メールアドレス（`normalizeEmail_` 済み）ごとの `{ name, statuses, accounts: [{ userId, status }] }` の `Map`。`checkDocusignUsers` と `createMaintenanceSheet` が使う
- 一覧・台帳の見出し行や空行は、行番号ではなく「メールアドレス列に `@` を含むか」で除外している。ただし `createMaintenanceSheet` は、台帳の行を「C 列が `true` で B 列が空でないか」で選び（`readCheckedLedgerRows_`）、同じメールアドレスを 1 人にまとめる（`mergeMaintenanceTargets_`）。部署（チェックのある台帳シート名）は Group 列に 1 つずつ並べ、Group 列の数は部署がいちばん多い人に合わせる。Docusign の CSV では、複数のグループは Group 列を増やして指定する（1 つのセルに区切って入れない）。
- 検査の 2 つ（`checkGroupMembers`・`checkDocusignUsers`）は、エラーをグループ単位で try/catch し、1 グループの失敗で全体を止めない。エラーは結果シートの一覧に行として出し、エラー件数に数える。検査の処理を追加するときはこの方針に合わせる。
- `createMaintenanceSheet` は逆に、見つからない台帳シートがある、Docusign の一覧を取得できない、ユーザー ID を 1 つに決められない、のどれかで、`メンテナンス用CSV` に書き込む前にエラーで止まる（メニューから実行した人がすぐ気付けるように、一部だけの出力やエラー行は書かない）。ユーザー ID は `selectMaintenanceUserId_` が ActivationSent → Active の順（定数 `CHECKER_MAINTENANCE_USER_STATUSES`）で選び、どちらもいない人は出力せず実行ログに残す。
- 検査の結果シートは、A:B 列に集計（開始・終了時刻、件数など）を書き、1 行空けて一覧表を書く形式。`メンテナンス用CSV` は集計を書かず、1 行目から見出しと一覧を書く。

**外部サービス。**
- Google グループのメンバーと表示名は、高度なサービス `AdminDirectory`（Admin SDK Directory API、`appsscript.json` で有効化）で取得する。実行ユーザーに Workspace の管理者権限が必要。
- Docusign の JWT Grant 認証は OAuth ライブラリを使わず `getDocusignAccessToken_` で自前実装している（RS256 署名は `Utilities.computeRsaSha256Signature`）。GAS は PKCS#8 形式の鍵しか受け付けないため、Docusign が発行する PKCS#1 形式（`BEGIN RSA PRIVATE KEY`）の鍵を `convertPkcs1ToPkcs8_` で変換している。
- `getDocusignAccessToken_` は、取得したトークンをグローバル変数 `checkerDocusignAccessToken` に持ち、同じ実行の中では使い回す。GAS のグローバル変数は実行ごとに初期化され、1 回の実行（最大 6 分）はトークンの有効期限（1 時間）より短いので、期限切れは見ていない。
- Docusign を呼ぶ関数は、応答の HTTP ステータスが 200 以外ならエラーにする。エラーを「該当なし」などの普通の結果として返さないこと。
  - 例外は、メールアドレスで検索して該当なしのとき。Docusign は HTTP 400 と errorCode `USER_NOT_FOUND`（定数 `CHECKER_DOCUSIGN_ERROR_USER_NOT_FOUND`）を返すので、`getDocusignUserId_` はこれだけを `"Not Found"` として扱う（実機で確認）。ほかの 400 はエラーのまま。errorCode は `getDocusignErrorCode_` で取り出す。
- 認証サーバー（本番の `account.docusign.com`。デモ環境なら `account-d.docusign.com`）と API のベース URL（`https://na4.docusign.net/restapi/v2.1`）は定数にハードコードしている。
- Docusign の接続情報（`DS_CLIENT_ID`、`DS_USER_ID`、`DS_PRIVATE_KEY`、`DS_ACCOUNT_ID`）はスクリプトプロパティにあり、リポジトリには含まれない。Apps Script エディタのプロジェクト設定で管理する。

<!--
**メイン処理（`コード.js`）。** `onOpen` が `⚙️ Docusign管理` メニューを追加し、その項目が `getAllSheet` を呼ぶ。
1. `共有事務グループ一覧` シートの E 列（index 4）から、メンバーシートのシート名を取得する。
2. メンバーシートの列構成は、A 列 = 氏名（`"姓 名"`、半角スペースで分割）、B 列 = メールアドレス、C 列 = チェックボックス。C 列が `true` の行だけを対象にする。
3. 対象の行ごとに `getDocusignUserId(email)` を呼び、DocuSign の一括ユーザー CSV 形式の行を作る。列は `UserEmail, APIUserName, FirstName, LastName, PermissionSet, CompanyName, Group, Language`。`PermissionSet`（`DS Sender`）、`CompanyName`、`Language`（`ja`）は固定値で、`Group` はシート名になる。
4. `メンテナンス用CSV` シートをクリアし（なければ作成し）、全行を書き込む。

`putCSV` は旧版の処理で、一覧シートではなく全シートを走査する。メニューには登録されていない。`チェッカ.js` は中身が空のプレースホルダ。

**DocuSign クライアント（`aaa.js`）。** JWT Grant 認証を OAuth ライブラリを使わずに自前で実装している。
- `getDocusignAccessToken` は `Utilities.computeRsaSha256Signature` で RS256 の JWT を作って署名し、`https://account.docusign.com/oauth/token` でアクセストークンと交換する。コメントには「開発環境」とあるが、これは**本番**の認証サーバー（デモ環境なら `account-d.docusign.com`）。
- `convertPkcs1ToPkcs8` が必要なのは、GAS が PKCS#8 形式の鍵しか受け付けない一方、DocuSign が発行する鍵は PKCS#1（`BEGIN RSA PRIVATE KEY`）形式だから。
- `getDocusignUserInfo` は、ハードコードされたベース URL `https://na4.docusign.net` に対して `GET /restapi/v2.1/accounts/{id}/users?email=...` を呼ぶ。
- 秘密情報はスクリプトプロパティ（リポジトリではなく Apps Script エディタで設定）に保存されている。キーは `DS_CLIENT_ID`、`DS_USER_ID`（なりすまし対象ユーザーの GUID）、`DS_PRIVATE_KEY`、`DS_ACCOUNT_ID`。
-->
## 注意点

- GAS の 1 回の実行時間は最大 6 分。`checkGroupMembers` は「Googleグループのみにあり」のメンバーごとに Directory API を 1 回呼ぶ（`getMemberDisplayName_`）ので、グループや差分が増えると時間がかかる。
- OAuth スコープは `appsscript.json` の `oauthScopes` に明示している。明示すると自動検出は働かないので、新しいサービスや API を使うとき（`コード.js` 側も含む）は、ここにスコープを追加すること。書き忘れても push の時点では分からず、実行時に権限不足のエラーになる。
- Admin SDK のスコープは読み取り専用（`.readonly`）だけにしている。グループやユーザーを変更する処理は、今のスコープでは動かない。
- スコープを変えて push したら、トリガーを作ったアカウント（Workspace 管理者）でエディタから関数を 1 回実行し、承認し直すこと。承認するまで、週 1 回のトリガー実行は失敗する。

<!--
- `getDocusignUserInfo` は該当ユーザーがいないと文字列 `"Not Found"` を返す。この文字列は truthy なので `getAllSheet` の `if (userId)` では除外されず、未登録のユーザーも `APIUserName = "Not Found"` のまま CSV に出力される。
- `getDocusignUserId(mailAddresses)` は引数名に反してメールアドレスを 1 件だけ受け取る。また呼び出しのたびにアクセストークンを取り直すため、メンバー 1 人あたり HTTP リクエストが 2 回発生する。メンバーが増えたら GAS の実行時間制限と UrlFetch の割り当てに注意すること。
-->
