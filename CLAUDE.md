# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

このファイルは日本語で記載すること。

## 仕様

仕様は [spec.md](spec.md) を参照すること。

## 概要

Google スプレッドシートにバインドされた Google Apps Script（GAS、V8 ランタイム）のプロジェクト。グループごとのメンバーシートを読み取り、GWS上のグループとメンバーを比較した結果を出力する。
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
- 関数は Apps Script エディタかスプレッドシートのメニューから実行する。`clasp run` は GCP や API 実行可能ファイルの追加設定をしないと使えない。
- 動作確認は、エディタから `test1`（ハードコードしたメールアドレスでユーザー ID を検索する）か `main` を実行し、実行ログを見る。

## アーキテクチャ

使用する `.js` ファイルは `チェッカ.js` のみとする。他の `.js` ファイルは現時点では無視する。

**GAS のグローバルスコープ。** すべての `.js` ファイルが 1 つのグローバル名前空間を共有する。import/export はなく、関数はファイルをまたいで呼び出される
<!--
（`コード.js` が `aaa.js` の `getDocusignUserId` を呼ぶ）。関数名は全ファイルで一意にすること。
-->
ファイル名（`コード.js`、`チェッカ.js`）は日本語版 Apps Script エディタの既定名に由来する。ファイル名を変えるとリモートのプロジェクトも変わるので、変更しないこと。

**メイン処理（`チェッカ.js`）。**
詳細仕様は `spec.md` を参照すること。

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

<!--
- `getDocusignUserInfo` は該当ユーザーがいないと文字列 `"Not Found"` を返す。この文字列は truthy なので `getAllSheet` の `if (userId)` では除外されず、未登録のユーザーも `APIUserName = "Not Found"` のまま CSV に出力される。
- `getDocusignUserId(mailAddresses)` は引数名に反してメールアドレスを 1 件だけ受け取る。また呼び出しのたびにアクセストークンを取り直すため、メンバー 1 人あたり HTTP リクエストが 2 回発生する。メンバーが増えたら GAS の実行時間制限と UrlFetch の割り当てに注意すること。
-->
