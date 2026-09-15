<p align="center">
  <img src="web/public/icons/icon-192.png" width="96" alt="">
</p>

<h1 align="center">Hearthroom</h1>

<p align="center">
  AI キャラクターカードのオープンプラットフォーム：コミュニティのランキング、ブラウザー内で遊べるチャット、コミュニティ審査を経た配布。<br>
  単一の Cloudflare Worker で動作します。
</p>

<p align="center">
  <a href="https://hearthroom.club"><img src="https://img.shields.io/website?url=https%3A%2F%2Fhearthroom.club&label=hearthroom.club" alt="Website"></a>
  <a href="https://discord.gg/FCEYZCFtR"><img src="https://img.shields.io/badge/Discord-join%20the%20community-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://github.com/hearthroom/hearthroom/actions/workflows/deploy.yml"><img src="https://github.com/hearthroom/hearthroom/actions/workflows/deploy.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/hearthroom/hearthroom" alt="License: AGPL-3.0"></a>
  <a href="https://github.com/hearthroom/hearthroom/commits/main"><img src="https://img.shields.io/github/last-commit/hearthroom/hearthroom" alt="Last commit"></a>
  <a href="https://github.com/hearthroom/hearthroom/stargazers"><img src="https://img.shields.io/github/stars/hearthroom/hearthroom?style=social" alt="GitHub stars"></a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-Hant.md">繁體中文</a> ·
  <a href="README.zh-Hans.md">简体中文</a> ·
  <b>日本語</b> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <img src="docs/screenshots/board-dark.png" width="800" alt="Hearthroom ランキング（ダーク）">
</p>

## 概要

Hearthroom は AI キャラクターカードのオープンソースプラットフォームで、3 つの部分から成ります。

- **ランキング**——作者がカードを登録し、読者は日間・週間・月間ランキング、名前・紹介文・タグでの検索、作者ページからカードを探します。
- **チャット**——掲載されたカードはすべてブラウザー内で遊べます。チャットステージ（`stage/` サブモジュールとして取り込んでいる別のオープンソースプロジェクト）が会話、カードのステータスバーとパネルを描画し、カードのスクリプトをサンドボックスで実行します。
- **配布**——カードは掲載前にコミュニティ審査を受け、開くとルール、世界設定、画像とともに読み込まれます。SillyTavern の PNG／JSON カードをインポートできます。

SillyTavern との違いは実行場所です。ローカルへのインストールは不要で、ユーザーが API キーを設定することもありません。サインイン、カードの保存、テキスト生成は**カードプロバイダー**（オープン API を持つチャットサービス）が担います。Hearthroom が保存するのは登録情報（どのカードが掲載されているか）、審査状態、検索インデックス、サイトの設定です。作者はプロバイダー経由でサインインし、カード ID で登録します。サイトは 1 時間ごとにプロバイダーからカードの公開項目をコピーします。カードの内容はサイトには保存されません。

審査の流れ：審査員は共有キューから申請を取ります。初回審査は 2 人の承認、再審査は 1 人の承認が必要で、1 人でも却下すれば却下、審査ページには作者が表示されません。承認はカードの内容バージョンに紐づき、作者がカードを編集するとランキングから外れて再びキューに入ります。

## 機能

- 日間・週間・月間ランキング、人気順・新着順、タグ絞り込み、作者ランキング、言語ゾーン。
- 名前、紹介文、タグでの検索。
- 作者ページ（その作者のカード一覧）。
- カードエディター：人物像、最初のメッセージ、世界設定、テスト欄付きの正規表現ルール、画像項目、幅を変えられる会話テストパネル。SillyTavern の PNG／JSON カードをインポート可能。
- 2 種類のチャットページ：カードのスタイルとスクリプトを隔離するサンドボックスページ（既定）と、古いカード向けの従来ページ。作者向けの仕様は[カード作成ガイド](docs/guide/card-authoring.ja.md)を参照。
- コミュニティ審査：匿名審査、2 人承認、内容バージョンに紐づく掲載。
- 成人向けコンテンツの年齢確認とタグ単位の非表示。
- デスクトップとモバイルで Web アプリとしてインストール可能。
- 5 つの UI 言語：繁体字中国語、簡体字中国語、英語、日本語、韓国語。

<p align="center">
  <img src="docs/screenshots/board-light.png" width="49%" alt="ランキング（ライト）">
  <img src="docs/screenshots/guide.png" width="49%" alt="カード作成ガイド">
</p>
<p align="center"><sub>スクリーンショットはデモ用カードです。</sub></p>

## 使い方

公開インスタンス：[hearthroom.club](https://hearthroom.club)

1. ランキング、検索、カードページ、作者ページは公開です。
2. カードプロバイダーのアカウントで**サインイン**します。プロバイダーはこのサイト向けのトークンを発行し、サイトはパスワードを受け取りません。
3. **マイカード**にプロバイダー側のカードが表示されます。1 枚選んで審査に出すか、エディターで新しいカードを作成します。作者ごとに週の登録上限があります。
4. [カード作成ガイド](https://hearthroom.club/guide)では項目、ルール、サンドボックス作者 API、他プラットフォームからのインポートを説明しています。
5. [開発者ドキュメント](https://hearthroom.club/developers)と [OpenAPI 記述](docs/openapi.json)で HTTP API を説明しています。

## アーキテクチャ

```
src/          Cloudflare Worker（Hono）：コミュニティ API、審査、毎時同期、共有プレビュー
web/          Vue 3 + Vite の SPA、5 言語
migrations/   D1 スキーマ
stage/        チャットステージ（git サブモジュール、コミット固定）：/play で使う会話 UI
docs/         開発者ドキュメント、OpenAPI 記述、カード作成ガイド、アーキテクチャノート
scripts/      デプロイ前チェック、アセット保管、審査員付与、ローカル開発用のモックプロバイダー
```

API と web アプリは 1 つの Worker が配信します。`/v1/*` は Hono が処理し、それ以外のパスはビルド済み SPA に渡されます。ストレージ：登録・メンバー・審査は D1、レスポンスキャッシュと過去のアセットビルド（デプロイ前に開いたタブが自分のチャンクを読み込めるようにするため）は KV、利用イベント（任意）は Analytics Engine。cron トリガーが 1 時間ごとにプロバイダーからカード名、カバー、人気カウンターを同期します。

チャットステージはビルド時に SPA に組み込まれます。ステージの変更はステージ自身のリポジトリに送り、このリポジトリは固定コミットの更新のみを行います。

個々の設計判断とその理由は [docs/architecture.zh-Hant.md](docs/architecture.zh-Hant.md)（繁体字中国語）にあります。

## 開発

Node 22 と npm が必要です。web のテストは Node 26 では動きません（組み込みの `localStorage` グローバルのため）。

```bash
git clone --recurse-submodules https://github.com/hearthroom/hearthroom.git
cd hearthroom
npm install                 # Worker と web ワークスペースをインストール
npm run migrate:local       # ローカル DB に D1 マイグレーションを適用
npm run build:stage         # チャットステージをビルド。web のビルドとテストに必要
npm run dev                 # Worker、:8787
npm run dev:web             # Vite、:8850、/v1 を :8787 にプロキシ
```

| コマンド | 説明 |
|---|---|
| `npm test` | Worker のテスト（Vitest、Workers pool）と web のテスト |
| `npm run typecheck` | Worker の型を生成し、両パッケージを型チェック |
| `npm run build` | ステージと web アプリをビルドして `web/dist` に出力 |
| `npm run i18n -w web` | 言語ごとの翻訳カバレッジを報告し、コンポーネント内の未翻訳文字列を列挙 |
| `npm run sync:stage` | ステージ上流の `main` を取得、テスト実行、再ビルドし、サブモジュールのポインターを更新（コミットはしない） |

### プロバイダーのアカウントなしでエディターを開発する

エディターはプロバイダーとの OAuth を必要とし、`localhost` では完了できません。`scripts/mock-upstream.mjs` はプロバイダーのインメモリ代替で、どんな bearer トークンでも受け付けます。

```bash
node scripts/mock-upstream.mjs                                  # :8899
VITE_PROVIDER_API_BASE=http://127.0.0.1:8899 npm run dev:web
```

ブラウザーのコンソールでトークンを設定します。

```js
localStorage.setItem("hearthroom.oauth.access", JSON.stringify({ accessToken: "tok", expiresAt: Date.now() + 3600e3 }));
```

モックの `/__log` は受け取ったリクエストを一覧表示します。`scripts/fixtures/` 配下のファイル（git 管理外）は `/fixtures/<名前>` で配信され、インポートのテストに使えます。

## セルフホスト

サイトは 1 つの Cloudflare アカウントで動作します。小さなコミュニティなら無料枠で足ります。

1. リソースを作成し、ID を `wrangler.toml` に記入します：D1 データベース（`DB`）、KV ネームスペース 2 つ（`CACHE`、`ASSET_ARCHIVE`）、任意で Analytics Engine データセット（`EVENTS`。無効にするには `ANALYTICS_ENABLED = "false"`）。
2. ドメインを設定します：`wrangler.toml` の `routes`、`src/site.ts` の `HOST`、`web/src/lib/site.ts` のサイト名。既に DNS レコードがあるホスト名にはカスタムドメインを付けられないため、パーキングレコードを先に削除します。
3. プロバイダーを設定します：`[vars]` の `PROVIDER_API_BASE`。一部の国からプロバイダーのメインドメインに届かない場合は、`PROVIDER_API_GATEWAYS` に国別ゲートウェイ（`CC=URL,…`）を列挙します。`/v1/region` がその国のブラウザーに対応するゲートウェイを返します。
4. 任意で審査ボットを設定します：`[vars]` の `REVIEW_BOT_ACCOUNT_NUM_ID` と `wrangler secret put REVIEW_BOT_KEY`。両方がない場合、申請は審査なしで掲載されます。審査員は `node scripts/grant-reviewer.mjs <プロバイダーのアカウント ID>` で付与します。
5. 任意で `wrangler secret put SHORTCUT_SECRET`（任意のランダム文字列）を設定します。成人向けコンテンツを有効にしたメンバーが成人向けカードをホーム画面に追加するための短期キーの署名に使います。未設定の場合、成人向けカードにはそのボタンが表示されません。
6. デプロイします：

```bash
npm run migrate:remote
npm run deploy              # 事前チェック、型チェック、テスト、ビルドを先に実行
```

`.github/workflows/deploy.yml` のワークフローは、すべての push と PR で型チェック、ビルド、テストを実行します。`main` では、リポジトリの secrets `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` が設定されていればマイグレーションの適用とデプロイも行います。未設定の場合はデプロイ手順をスキップし、実行は成功として扱われます。

## コミュニティ

議論、カードの共有、開発の調整は [Discord](https://discord.gg/FCEYZCFtR) で行っています。バグ報告と機能要望は [GitHub issue](https://github.com/hearthroom/hearthroom/issues) へ。

## コントリビュート

- **Issue**——バグの場合はページ、ブラウザー、期待した動作を記載してください。
- **Pull Request**——CI はすべての PR で型チェック、ビルド、テストを実行します。1 つの PR には 1 つの変更、テストは対応するコードの隣に（Worker は `test/`、web は `web/test/`）、push 前に `npm test` を実行してください。
- **翻訳**——UI 文字列は `web/src/locales/<言語>.json` にあり、1 言語 1 ファイルです。`npm run i18n -w web` が言語ごとの不足キーを報告します。新しい文字列は 5 ファイルすべてに追加してください。コンポーネントに未翻訳の文字列があるとテスト手順が失敗します。カード作成ガイドは `docs/guide/` に言語ごとに 1 ファイルあります。
- **チャットステージ**——会話 UI の変更はステージのリポジトリに送ります。ここでは行いません。
- **ライセンス**——コントリビュートはプロジェクトと同じ AGPL-3.0 で受け付けます。

## ライセンス

[GNU Affero General Public License v3.0](LICENSE)。改変版をネットワークサービスとして運用する場合は、その利用者に改変後のソースコードを提供する必要があります。
