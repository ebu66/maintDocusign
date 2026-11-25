# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

このファイルは日本語で記載すること。

## 仕様

仕様は [spec.md](spec.md) を参照すること。動作を変えるときは `spec.md` も同じ変更で更新し、コードと仕様を一致させること。

## 概要

Google スプレッドシートにバインドされた Google Apps Script（GAS、V8 ランタイム）のプロジェクト。機能は次の 2 つで、どちらも `チェッカ.js` に実装されている。

- **`checkGroupMembers`**：`共有事務グループ一覧` シートに載っているグループごとに、台帳シートのメンバーと GWS 上の Google グループのメンバーを比較する。差分を `検査結果` シートに出力し、結果をメールで通知する。
- **`checkDocusignUsers`**：台帳のメールアドレスが Docusign のユーザーとして登録されているか（登録されていればそのステータス）を確認する。Docusign にあってどの台帳にもないユーザーとあわせて `Docusign確認結果` シートに出力する。メール通知はしない。

<!--
チェックの付いたメンバーの DocuSign ユーザー ID を DocuSign REST API で検索し、DocuSign のユーザーメンテナンス用 CSV データをシートに出力する。
-->
ソースは [clasp](https://github.com/google/clasp)（3.x、グローバルにインストール済みで `package.json` には含まれない）で同期する。

## コマンド

ビルド・リント・テストの仕組みはない。`npm install` で入るのはエディタ補完用の `@types/google-apps-script` だけ（`jsconfig.json`、`checkJs: false`）。

```sh
clasp status          # push でアップロードされるファイルを一覧表示（ルート直下の .js/.gs と appsscript.json）
clasp push            # ローカルのファイルでリモートのプロジェクトを上書きする
clasp pull            # リモートのプロジェクトを取得する。オンラインエディタでコードが変更された可能性があれば、編集前に実行する
clasp open-script     # Apps Script エディタを開く
clasp open-container  # バインド先のスプレッドシートを開く
```

- `.clasp.json`（スクリプト ID、`rootDir: ""`）は gitignore 対象だが、clasp の動作に必要。
- push 先は `.clasp.json` のスクリプト 1 つだけで、テスト用のプロジェクトはない。push した内容はそのまま本番で動く。
- 関数は Apps Script エディタかスプレッドシートのメニューから実行する。`clasp run` は GCP や API 実行可能ファイルの追加設定をしないと使えない。ローカルで実行・テストする手段はない。
- 動作確認は、エディタで `checkGroupMembers` か `checkDocusignUsers` を実行し、実行ログと出力先のシートを見る。どちらも本番のスプレッドシート（`CHECKER_SPREADSHEET_ID`）と本番の Docusign を相手に動き、`checkGroupMembers` は実行するたびに `CHECKER_NOTIFY_TO` 宛てに実際にメールを送る。

## アーキテクチャ

使用する `.js` ファイルは `チェッカ.js` のみとする。他の `.js` ファイルは現時点では無視する。
ただし `コード.js` の `getAllSheet` が `チェッカ.js` の `getDocusignUserId` を呼んでいるので、この関数は削除・改名しないこと。

**GAS のグローバルスコープ。** すべての `.js` ファイルが 1 つのグローバル名前空間を共有する。import/export はなく、関数はファイルをまたいで呼び出される。`コード.js` も push されるので、その関数名（`onOpen`、`getAllSheet`、`putCSV`）と同じ名前を `チェッカ.js` で定義しないこと。
ファイル名（`コード.js`、`チェッカ.js`）は日本語版 Apps Script エディタの既定名に由来する。ファイル名を変えるとリモートのプロジェクトも変わるので、変更しないこと。

**メイン処理（`チェッカ.js`）。**
詳細仕様は `spec.md` を参照すること。前半が Google グループとの比較、後半が Docusign 確認で、それぞれの先頭に `CHECKER_` で始まる定数をまとめている。

- エディタから実行する入口は `checkGroupMembers` と `checkDocusignUsers`（と `コード.js` 用の `getDocusignUserId`）だけ。それ以外の関数名は `_` で終える（GAS では `_` で終わる関数はエディタの実行メニューに出ない private 関数になる）。
- 2 つの機能で共有する関数：
  - `readGroupList_`：`共有事務グループ一覧` の C/D/E 列 → グループ名称・グループのメールアドレス・台帳シート名
  - `readLedger_`：台帳シートの A/B 列 → メールアドレス → 氏名 の `Map`
  - `normalizeEmail_`：trim と小文字化。メールアドレスの比較・`Map` のキーは必ずこれを通す
  - `prepareResultSheet_`：結果シートがあればクリアし、なければ追加する
- 一覧・台帳の見出し行や空行は、行番号ではなく「メールアドレス列に `@` を含むか」で除外している。
- エラーはグループ単位で try/catch し、1 グループの失敗で全体を止めない。エラーは結果シートの一覧に行として出し、エラー件数に数える。処理を追加するときもこの方針に合わせる。
- 結果シートは、A:B 列に集計（開始・終了時刻、件数など）を書き、1 行空けて一覧表を書く形式。

**外部サービス。**
- Google グループのメンバーと表示名は、高度なサービス `AdminDirectory`（Admin SDK Directory API、`appsscript.json` で有効化）で取得する。実行ユーザーに Workspace の管理者権限が必要。
- Docusign の JWT Grant 認証は OAuth ライブラリを使わず `getDocusignAccessToken_` で自前実装している（RS256 署名は `Utilities.computeRsaSha256Signature`）。GAS は PKCS#8 形式の鍵しか受け付けないため、Docusign が発行する PKCS#1 形式（`BEGIN RSA PRIVATE KEY`）の鍵を `convertPkcs1ToPkcs8_` で変換している。
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
