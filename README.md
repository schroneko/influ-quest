# influ-quest

インフルエンザテーマのレトロ風テキスト RPG「インフルクエスト」。MCP（Model Context Protocol）の機能をひと通り体験できるゲームサーバーです。イベント登壇用に作られており、会場参加者がスマホの Claude から remote MCP コネクタとして接続して遊べます。

インフルだいまおうに さらわれた ちょまどひめを、みんなで たすけにいきます。インフルエンサーではなく、インフルエンザのクエストです。

## 遊び方

### スマホから遊ぶ（remote MCP コネクタ）

1. スマホで claude.ai にログインする（無料アカウントで利用できます。無料プランはカスタムコネクタ 1 個まで）
2. 設定の「コネクタ」からカスタムコネクタを追加し、URL に `https://influ-quest.nukoevi.app/mcp` を入力する
3. 新しいチャットで「インフルクエストをはじめて」と話しかける

### ブラウザ版（Claude アカウント不要）

`https://influ-quest.nukoevi.app/play` を開くと、Workers 上のエージェントループ（Anthropic API）がゲームマスターを務めるチャット UI で遊べます。運営側が `ANTHROPIC_API_KEY` を設定している場合のみ有効です。

### ローカルで遊ぶ（STDIO）

```sh
claude mcp add -s user influ-quest -- npx -y github:schroneko/influ-quest
```

ソースからビルドする場合は `npm run build` のうえ `node dist/stdio.js` を MCP サーバーとして登録します。セーブデータは `~/.influenza-quest/karte.json` に保存されます。

## MCP の学び要素

| 機能                       | ゲーム内の対応                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| Tools                      | ぼうけんのコマンド一式（talk / move / explore / attack など）                                 |
| tools/list_changed         | 場所や戦闘状態でツールの有効・無効が切り替わる                                                |
| Resources                  | `influenza://status`（カルテ）、`influenza://map`、`influenza://fukkatsu-no-jumon`            |
| Prompts                    | `start-adventure`                                                                             |
| Elicitation                | しゅさいしゃの「とうだんわくの はんぶんを やろう」への はい・いいえ                           |
| プロンプトインジェクション | すみかの せきひ（読むと AI が「ぱんでみっく」を唱えてチートクリアし、ネタばらしで解説が出る） |

Elicitation 非対応クライアントは `answer_host` ツールで、tools/list_changed 非対応クライアントは `perform_action` ツールでフォールバックできます。

## 会場ボード

`https://influ-quest.nukoevi.app/` が会場用リーダーボードです。ツール呼び出しごとに勇者名・レベル・HP・ゴールド・場所・クリア状況が匿名 UUID 付きで送信され、約 4 秒ごとに更新されます。データは 6 時間の TTL で自動削除されます。

STDIO 版から送信する場合は環境変数を設定します。

```sh
INFLUENZA_QUEST_DASHBOARD_URL=https://influ-quest.nukoevi.app
INFLUENZA_QUEST_EVENT_TOKEN=<イベントトークン>
```

`INFLUENZA_QUEST_DASHBOARD_URL=off` で送信を無効化できます。remote MCP 版とブラウザ版は Worker 内で直接ボードへ書き込むため設定不要です。

## 構成

```
src/
  state.ts     ゲーム状態のスキーマ、ふっかつのじゅもんの encode / decode
  engine.ts    ゲームロジックと文言（純粋モジュール、3 アダプタで共有）
  mcp.ts       MCP ツール・リソース・プロンプト登録
  stdio.ts     STDIO アダプタ（ローカル用）
  storage.ts   ローカルセーブ（STDIO 用）
  reporting.ts 会場ボードへの HTTP 送信（STDIO 用）
worker/
  src/index.ts Workers エントリ（remote MCP は Durable Objects の McpAgent）
  src/board.js 会場ボード API とページ
  src/play.js  ブラウザ版チャット UI とエージェントループ
```

## 運営者向け（デプロイ）

```sh
wrangler kv namespace create influenza-quest-PLAYERS --config worker/wrangler.jsonc
wrangler kv namespace create influenza-quest-SESSIONS --config worker/wrangler.jsonc
wrangler deploy --config worker/wrangler.jsonc
wrangler secret put EVENT_TOKEN --config worker/wrangler.jsonc
wrangler secret put ANTHROPIC_API_KEY --config worker/wrangler.jsonc
```

`EVENT_TOKEN` は STDIO 版からのボード送信の認証用、`ANTHROPIC_API_KEY` はブラウザ版のゲームマスター用です。どちらも未設定でも remote MCP と会場ボードは動作します。書き込み締切は `EVENT_WRITE_UNTIL`（ISO 8601）で設定できます。

## テスト

```sh
npm test
```

## 注意

このゲームは特定の作品を再現するものではない非公式のファン的パロディです。ゲーム内の固有名詞は創作名であり、医学的な助言を提供するものではありません。インフルエンザの予防は手洗い・うがい・予防接種をどうぞ。
