<p align="center">
  <img src="web/public/icons/icon-192.png" width="96" alt="">
</p>

<h1 align="center">Hearthroom</h1>

<p align="center">
AI キャラクターカードのオープンな酒場：コミュニティのランキング、サイト内でそのまま遊べるチャット、そしてカードの配布。<br>
  ランキング、検索、作者ページ、カードエディター、コミュニティ審査を、1 つの Cloudflare Worker で。
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
  <img src="docs/screenshots/board-dark.png" width="800" alt="Hearthroom のランキング（ダーク）">
</p>

## Hearthroom とは

Hearthroom は AI キャラクターカードのオープンなプラットフォームで、3 つの役割を 1 つにまとめています。

- **ランキング**——作者がカードを登録し、読者は日間・週間・月間ランキング、検索、タグ、作者ページからカードを探します。
- **酒場**——どのカードもサイト上でそのまま遊べます。チャットステージ（別のオープンソースプロジェクトで、`stage/` サブモジュールとして取り込み）が会話、カードのステータスバー、パネル、スクリプトを描画し、カードのスクリプトはサンドボックスで実行されます。
- **配布**——カードはコミュニティ審査を経て、ルール、世界設定、画像とともに開いた人全員に届きます。SillyTavern などの形式からのインポートも内蔵しています。

オープンソースの酒場ですが、SillyTavern のクローンではありません。ローカルへのインストールも、API キーの管理も不要です。カードと会話は**カードプロバイダー**——サインイン、カードデータ、生成のためのオープン API を公開しているチャットサービス——側にあります。Hearthroom が持つのはランキング、審査プロセス、検索インデックス、そして遊ぶ画面です。作者はプロバイダー経由でサインインし、カード ID で登録します。サイトは 1 時間ごとにプロバイダーから公開項目を同期します。このサイトを閉じても、カードは 1 文字も失われません。

掲載には**コミュニティ審査**があります。審査員は共有キューから申請を引き受け、初回審査は 2 人の承認、再審査は 1 人の承認が必要で、1 人でも却下すれば却下、審査ページには作者が表示されません。承認はカードの内容バージョンに紐づき、作者がカードを変更するとランキングから外れて再びキューに並びます。

## 機能

- **ランキング**——日間・週間・月間、人気順・新着順、タグ絞り込み、作者ランキング、言語ゾーン。
- **検索**——名前、紹介文、タグ。
- **作者ページ**——その作者の掲載カードをすべて表示。
- **カードエディター**——人物像、最初のメッセージ、世界設定、テスト欄付きの正規表現ルール、画像項目、幅を変えられる会話テストパネル。SillyTavern の PNG／JSON カードをインポート可能。
- **2 種類のチャットページ**——カードのスタイルとスクリプトを隔離して実行するサンドボックスページ（既定）と、古いカード向けの従来ページ。作者向けの仕様は[カード作成ガイド](docs/guide/card-authoring.ja.md)に。
- **コミュニティ審査**——匿名審査、2 人承認、内容バージョンに紐づく掲載。
- **成人向けコンテンツの区分**——年齢確認とタグ単位の非表示。
- **インストール可能**——デスクトップとモバイルで Web アプリとして。
- **5 言語**——繁体字中国語、簡体字中国語、英語、日本語、韓国語。

<p align="center">
  <img src="docs/screenshots/board-light.png" width="49%" alt="ランキング（ライト）">
  <img src="docs/screenshots/guide.png" width="49%" alt="カード作成ガイド">
</p>
<p align="center"><sub>スクリーンショットはデモ用カードです。</sub></p>

## 使い方

公開インスタンスは **[hearthroom.club](https://hearthroom.club)** です。

1. **閲覧**にアカウントは不要：ランキング、検索、カードページ、作者ページは公開です。
2. **サインイン**：「ログイン」からカードプロバイダーのアカウントで認可します。Hearthroom はパスワードを見ません。プロバイダーがこのサイト向けのトークンを発行します。
3. **カードを登録**：「マイカード」にプロバイダー側のカードが並びます。1 枚選んで審査に出すか、エディターで新しく作ります。作者ごとに週の登録上限があります。
4. **カードを書く**：[カード作成ガイド](https://hearthroom.club/guide)——項目、ルール、サンドボックス作者 API、他プラットフォームからのインポート。
5. **連携**：[開発者ドキュメント](https://hearthroom.club/developers)と [OpenAPI 記述](docs/openapi.json)。

## 仕組み

```
src/          Cloudflare Worker（Hono）：コミュニティ API、審査、毎時同期、共有プレビュー
web/          Vue 3 + Vite の SPA、5 言語
migrations/   D1 スキーマ
stage/        チャットステージ（git サブモジュール、コミット固定）：/play で使う会話 UI
docs/         開発者ドキュメント、OpenAPI 記述、カード作成ガイド、アーキテクチャノート
scripts/      デプロイ前チェック、アセット保管、審査員付与、ローカル開発用のモックアップストリーム
```

API とフロントエンドは**1 つの Worker** で動きます。`/v1/*` は Hono が処理し、それ以外はビルド済み SPA に渡ります。ストレージは **D1**（登録、メンバー、審査）、**KV**（レスポンスキャッシュと、デプロイ後も開いたままのタブが壊れないよう過去のアセットビルドを保管）、任意で **Analytics Engine**（利用イベント）。cron トリガーが 1 時間ごとにプロバイダーからカード名、カバー、人気シグナルを同期します。

チャットステージは別のオープンソースプロジェクトで、`stage/` サブモジュールとして取り込み、ビルド時に SPA に組み込みます。変更は上流に送り、このリポジトリは固定コミットを動かすだけです。

設計判断とその理由は [docs/architecture.zh-Hant.md](docs/architecture.zh-Hant.md)（繁体字中国語）にまとめています。

## 開発

Node 22 と npm が必要です。フロントエンドのテストは Node 26 では組み込みの `localStorage` グローバルのため失敗します。

```bash
git clone --recurse-submodules https://github.com/hearthroom/hearthroom.git
cd hearthroom
npm install                 # workspaces：Worker と web をまとめてインストール
npm run migrate:local       # ローカル DB に D1 マイグレーションを適用
npm run build:stage         # チャットステージを一度ビルド（web のビルドとテストに必要）
npm run dev                 # Worker、:8787
npm run dev:web             # Vite、:8850、/v1 を :8787 にプロキシ
```

よく使うコマンド：

| コマンド | 内容 |
|---|---|
| `npm test` | Worker のテスト（Vitest、Workers pool）と web のテスト |
| `npm run typecheck` | Worker の型を生成し、両パッケージを型チェック |
| `npm run build` | ステージと web アプリをビルドして `web/dist` に出力 |
| `npm run i18n -w web` | 言語ごとの翻訳カバレッジを報告し、コンポーネント内の未翻訳文字列を検出 |
| `npm run sync:stage` | ステージ上流の `main` を取得、テスト実行、再ビルド。サブモジュールのポインタはコミット待ちの状態に |

### ローカルでエディターを触る

エディターはプロバイダーの OAuth の背後にあり、`localhost` では完了できません。モックプロバイダーを使います：カードはメモリに保持され、どんな bearer トークンも認証済みとして扱われます。

```bash
node scripts/mock-upstream.mjs                                  # :8899
VITE_PROVIDER_API_BASE=http://127.0.0.1:8899 npm run dev:web
```

続けてブラウザのコンソールでトークンを置きます：

```js
localStorage.setItem("hearthroom.oauth.access", JSON.stringify({ accessToken: "tok", expiresAt: Date.now() + 3600e3 }));
```

モックの `/__log` で受け取ったリクエストを確認できます。`scripts/fixtures/`（git 管理外）に置いたファイルは `/fixtures/<名前>` で配信され、インポートのテストに使えます。

## セルフホスト

すべて 1 つの Cloudflare アカウントで動き、小さなコミュニティなら無料枠で足ります。

1. リソースを作成し、ID を `wrangler.toml` に記入：**D1** データベース（`DB`）、**KV** ネームスペース 2 つ（`CACHE`、`ASSET_ARCHIVE`）、任意で **Analytics Engine** データセット（`EVENTS`。使わない場合は `ANALYTICS_ENABLED = "false"`）。
2. 自分のドメインに向ける：`wrangler.toml` の `routes`、`src/site.ts` の `HOST`、`web/src/lib/site.ts` のサイト名。カスタムドメインは既に DNS レコードがあるホスト名には付けられないので、パーキングレコードを先に削除します。
3. プロバイダーの設定：`[vars]` の `PROVIDER_API_BASE`。一部の国からプロバイダーのメインドメインに届かない場合は、`PROVIDER_API_GATEWAYS` に国別のゲートウェイ（`CC=URL,…`）を列挙します。`/v1/region` がその国のブラウザーに対応する URL を渡します。
4. 任意の審査ボット：`[vars]` の `REVIEW_BOT_ACCOUNT_NUM_ID` と `wrangler secret put REVIEW_BOT_KEY`。両方がなければ申請は審査なしで即掲載になります。審査員は `node scripts/grant-reviewer.mjs <プロバイダーのアカウント ID>` で付与します。
5. デプロイ：

```bash
npm run migrate:remote
npm run deploy              # 事前チェック、型チェック、テスト、ビルドを先に実行
```

**継続的デプロイ。** 同梱のワークフロー（`.github/workflows/deploy.yml`）はすべての push と PR で型チェック、ビルド、テストを行います。`main` では、リポジトリの secrets `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` が設定されていればマイグレーションを適用してデプロイし、未設定ならデプロイをスキップした旨を表示して緑のままにします。

## コミュニティ

プレイヤー、カード作者、開発者は **[Discord](https://discord.gg/FCEYZCFtR)** に集まっています。カードで遊ぶ、カードを書く、酒場とサイトを作る——どれでも歓迎です。バグ報告や機能要望は [GitHub issue](https://github.com/hearthroom/hearthroom/issues) でも受け付けています。

## コントリビュート

Issue と Pull Request を歓迎します。

- **バグと提案**——[issue](https://github.com/hearthroom/hearthroom/issues) を開いてください。バグはページ、ブラウザ、期待した表示を添えてください。
- **Pull Request**——すべての PR で型チェック、ビルド、テストが走ります。1 つの PR に 1 つの変更、テストは変更したコードの隣に（Worker は `test/`、フロントエンドは `web/test/`）、push 前に `npm test` を実行してください。
- **翻訳**——UI 文字列は `web/src/locales/<言語>.json`、1 言語 1 ファイルです。`npm run i18n -w web` で各言語の不足がわかります。新しい文字列は 5 ファイルすべてに追加してください。コンポーネントに未翻訳の文字列が残るとテストステップが失敗します。カード作成ガイドは `docs/guide/` に言語ごとに 1 ファイルあります。
- **チャットステージ**——会話 UI の変更はステージのプロジェクト側で行い、ここでは行いません。
- **ライセンス**——コントリビュートはプロジェクトと同じ AGPL-3.0 で受け付けます。

## ライセンス

[GNU Affero General Public License v3.0](LICENSE)。改変版をネットワークサービスとして運用する場合、その利用者にソースコードを提供する必要があります。
