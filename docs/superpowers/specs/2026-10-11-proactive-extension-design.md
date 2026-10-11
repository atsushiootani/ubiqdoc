# ubiqdoc 拡張版: 読み手の知識に合わせて先回りで補足する Chrome 拡張

- 日付: 2026-10-11
- 状態: 設計 (レビュー待ち)

## 何を作るか

ubiqdoc の「分からない語句をドラッグして AI に聞く」を Chrome 拡張に移し、さらに **読み手が知らなそうな概念に、聞かれる前に補足を付けておく** 機能を足す。

読み手は 1 人 (この拡張を入れた本人)。拡張は「本人がもう知っている概念」を知識プロフィールとして持ち、それ以外の概念にだけ補足を付ける。補足に「知ってる」を返すと、その概念はプロフィールに入り、以後どのページでも付かなくなる。

### 想定する場面

仕事の issue や設計書 (Notion / GitHub) には、前提になる業務知識が書かれておらず、リンクも無いことが多い。読み手はそのたびに別のページを探しに行く。初めて見る技術用語なら Web で調べる。拡張は、ページを開いた時点でこの「探しに行く」をできるだけ先に済ませておく。

### 方針 (決定済み)

| 項目 | 決定 |
|---|---|
| 置き場 | このリポジトリに `extension/` `host/` `core/` を足す。今の HTML リーダー (`server.js` / `public/`) は残す |
| AI の実行 | 常駐サーバは置かない。自前の native messaging host が `claude` CLI を叩く (Chrome が呼んだときだけ起動) |
| 先回りの補足 | 許可リストに入れたサイトでは開いたら自動。ほかのページは拡張のボタンで実行 |
| 補足の上限 | 1 ページあたり表示中 20 個 |
| 正本リンク | 補足には必ず出典 URL を付ける。真偽は読み手が出典で確かめる |
| 知識の単位 | 概念 (表記ゆれ・言い換えは同じ概念) |
| プロフィールの区分 | `personal` (技術知識) / `work` (業務知識)。区分は AI が判断し、迷ったら `work`。社外に出せない情報が少しでも入るなら `work` |
| プロフィールの置き場 | `data/` の下。**コミットに入れない** (起動時に検査する) |
| 照合 | ローカルの索引で照合する (LLM を使わない) |
| 押し間違い | 「知ってる」の直後にトーストで戻せる。プロフィール一覧からも戻せる |
| 見た目 | 先回りの補足とドラッグして聞いた補足は同じ見た目 |
| 描画 | ページの DOM を書き換えない (CSS Custom Highlight API + 最前面の層) |
| 右ペイン | Chrome のサイドパネル |

### やらないこと

- 本文の書き換え提案 (`<ubiqdoc-edit>`) と本文の直接編集。拡張が見せる本文と正本 (Notion / GitHub) がずれるため。本文を直すのは正本の側で行い、次に開いたときに付け直しが走る
- 矛盾の指摘 (本文どうし、本文と正本の食い違い)
- 計測指標
- 外部のループによる先読み (待ち時間が問題になってから検討する)
- Notion などを HTML に落とす処理 (HTML リーダー側の入力の話で、この拡張の責務ではない)

## 構成

```
ubiqdoc/
├─ server.js / public/   今の HTML リーダー。core を使うように差し替えるだけで、挙動は変えない
├─ core/                 server.js から切り出す共通部品
│   ├─ claude.js           claude -p の実行 (stream-json の読み取り、ベース作成、fork、resume)
│   ├─ prompts.js          system prompt と各段のプロンプト
│   ├─ answer.js           <ubiqdoc-*> タグの読み取り (逐次読み取りも)
│   └─ concept.js          概念キーの正規化
├─ host/                 native messaging host (Node 18+、依存なし)
│   ├─ host.js             stdio の枠 (4 バイト長 + JSON) と、要求の振り分け
│   ├─ pages.js            ページごとの補足 (page.json) とログ
│   ├─ profile.js          知識プロフィールと索引
│   ├─ guard.js            data/ がコミット対象になっていないかの検査
│   └─ install.sh          host の登録ファイルとラッパを作る
├─ extension/            Manifest V3。manifest に key を入れて拡張 ID を固定する
│   ├─ background.js       host との接続、許可リストの判定、タブとのやりとり
│   ├─ content/            本文の取得、補足の描画と付け直し、小窓 (ドラッグして聞く)
│   ├─ sidepanel/          書き込み履歴、承認待ち、見つからなくなった補足、プロフィール
│   └─ options/            許可リスト、モデル
└─ data/                 gitignore 済み。ext/pages/<ページキー>/ と profile/
```

### core を切り出す理由

プロンプトとタグの読み方を HTML リーダーと拡張で一字一句同じにするため。片方だけ古くなるのを防ぐ。`server.js` の `SYSTEM_PROMPT` / `runClaude` / `parseAnswer` / `buildFirstPrompt` / `buildFollowupPrompt` を `core/` に移し、`server.js` はそれを `require` する。

### 通信の経路

```
content script ⇄ background (service worker) ⇄ native host ⇄ claude -p
```

- background が `chrome.runtime.connectNative` で host への接続を 1 本だけ張る。全タブの要求はこの 1 本を通るので、host のプロセスは 1 つになり、プロフィールへの書き込みは順に並ぶ
- 接続中は service worker が停止しない。処理が無いまま 60 秒たったら background が接続を閉じ、host も終わる
- 小窓や先回りの答えのストリームは、host → background → content script の順に `delta` / `annotation` / `done` / `error` メッセージで届く。各メッセージには要求 ID を付ける
- content script はページの `window.postMessage` を受け付けない。やりとりは `chrome.runtime` だけ

### host の起動環境

Chrome が起動する native host は、ログインシェルの `PATH` を持たない。`node` や `claude` が見つからずに落ちる。`install.sh` は、実行した時点の `node` と `claude` の絶対パスを書き込んだラッパ `host/run.sh` を生成する (生成物は gitignore)。そのうえで、登録ファイル `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.atsushiootani.ubiqdoc.json` を置く。登録ファイルの `allowed_origins` は、この拡張の ID だけにする。

`claude` を叩くときの cwd は、今の HTML リーダーと同じ `~/.cache/ubiqdoc` に固定する (作業中のリポジトリの CLAUDE.md を拾わせないため)。

## データ

### ページの補足: `data/ext/pages/<ページキー>/page.json`

ページキーは、正規化した URL の sha1。正規化では `#` 以降と、追跡用・表示用のクエリ (`utm_*`、Notion の `pvs`) を落とす。Notion は URL にページ ID が入っているので、タイトルが変わっても同じページとして扱える。

```js
{
  url, title, model,
  baseSessionId, baseModel,
  textHash,                 // ベースに読ませた本文の sha1
  version,
  annotations: [{
    id,                     // a_01 ...
    turnId,                 // 先回りなら 1 回の実行ぶん、ドラッグなら質問 1 回ぶん
    windowId,               // ドラッグして聞いた場合の小窓
    origin: 'proactive' | 'ask',
    concept: { key, label, category: 'personal' | 'work' },
    kind: 'popover' | 'section' | 'link',
    anchor: { exact, prefix, suffix },   // 前後 24 文字
    title, body, href,
    sourceUrls: [ ... ],    // 1 つ以上
    dependsOn: [ ... ],
    createdAt,
    state: 'shown' | 'orphaned'           // 知っているかどうかは持たない (表示のたびにプロフィールで決める)
  }],
  pending: [ ... ],         // 既存の補足と重なって承認待ちになったもの (今の conflict と同じ)
  dropped: { noSource: 0 }  // 出典が付けられず捨てた数
}
```

会話ログは今と同じく `logs/<windowId>.jsonl` (先回りは `logs/proactive.jsonl`) に追記する。

### 知識プロフィール: `data/profile/personal.json` と `data/profile/work.json`

```js
{ concepts: [{ id, key, label, aliases: ['楽観ロック', 'optimistic locking'], addedAt, fromUrl }] }
```

- **索引** は host の起動時に 2 つのファイルから作るメモリ上の表 (正規化した表記 → 概念 ID)。正本は `concepts`。索引のファイルは持たない
- 書き込みは一時ファイルに書いてから rename する
- 表示のたびにプロフィールで絞り込む。ページ A で「知ってる」にした概念は、作ってあるページ B の補足からも、次の描画で消える

### 概念キーの正規化 (`core/concept.js`)

AI には概念キーを「英語の小文字。Wikipedia の見出し語に寄せる。単語の区切りは `-`」で書かせる。照合の前に、キーと別名の両方を次のように正規化する。

1. NFKC で全角英数字を半角にする
2. 小文字にする
3. 記号と空白を `-` にまとめ、前後の `-` を落とす
4. 英単語の末尾の複数形 (`-s` / `-es`) をそろえる

照合は「キーが一致」または「正規化した別名のどれかが一致」で知っているとみなす。

## 流れ

### ページを開いたとき

1. content script が本文の根を決める。許可リストの各行は `{ pattern, root }` を持つ。Notion (`.notion-page-content`) と GitHub (`.markdown-body`、issue / PR の本文) は最初から入れておく。どれにも当たらなければ `main`、無ければ `body`
2. DOM の変化が 1.5 秒止まるまで待ってから本文を取る。SPA の遷移 (`history.pushState` / `popstate`) は新しいページとして扱う
3. 本文と、本文中のリンクの一覧 (`href` と文字列) を host に送る。本文は 100 KB で切り、切ったことをサイドパネルに出す
4. host は `page.json` を読む。`textHash` が同じなら保存済みの補足を返して終わる
5. 初回、または本文が変わったときは次の 3 段を走らせる

#### 1 段目: 抜き出し

本文を読ませたベースセッションから fork して、説明が要りそうな概念を最大 60 個抜き出させる。出力は JSON ではなくタグで書かせる (長い出力を JSON にさせると壊れやすいことが HTML リーダーの試験で分かっている)。

```
<ubiqdoc-concept key="optimistic-locking" label="楽観ロック" category="personal" importance="4" exact="楽観ロック" prefix="更新時は"/>
```

`importance` は 1〜5。読み手がつまずくと本文全体の理解が止まるものほど高くする。

#### 2 段目: 照合 (host、LLM なし)

- 知識プロフィールで知っている概念を落とす
- このページで既に `shown` の概念を落とす
- 残りを `importance` の高い順に並べ、「20 − 表示中の数」個を取る

#### 3 段目: 補足を書く

同じベースから fork して、選んだ概念ごとに補足を書かせる。書き方は今の `<ubiqdoc-popover|section|link>` に `concept` `category` `source` 属性を足したもの。`source` は空白区切りで複数書ける。

出典に使えるのは次の 2 つだけ。

- 本文中のリンクの一覧にある URL (業務知識の出典は、たいていここから取る)
- 実在が確かな一次情報の URL (公式ドキュメント、仕様書、Wikipedia)

`source` が無い補足は表示しない。`dropped.noSource` を数え、サイドパネルに出す。

答えはストリームで読み、タグが 1 つ閉じるたびにその補足を content script に送る。20 個そろうのを待たずに、できたものから順に出す。作成中はツールバーのバッジとサイドパネルに「補足を作成中 7/20」と出す。

### ベースセッション

ページごとに 1 つ。今の HTML リーダーと同じく、本文を読ませて「OK」とだけ返させたセッションを作り、各段と各質問はそこから `--fork-session` する。本文のぶんがプロンプトキャッシュに乗る。`textHash` かモデルが変わったら作り直す。セッションファイルが消えていたら、作り直して 1 回だけやり直す。

### 本文が変わったとき

- 既存の補足をすべて付け直してみる。付け直せたものはそのまま残す
- 付け直せなかったものは `orphaned` にする。その概念は 1 段目の候補に戻るので、変わった本文に合わせて作り直される
- `orphaned` は消さない。サイドパネルの「見つからなくなった補足」に畳んで出す

### ドラッグして聞くとき

今の HTML リーダーと同じく、ベースから fork して答えがストリームで届き、続けて聞くと同じ会話を `--resume` する。窓は複数同時に開ける。

違うのは開き方だけ。語句を選ぶと、すぐ小窓を開くのではなく、選んだ語句の横に「AI に聞く」ボタンを出す。Notion では文字を選ぶのはコピーや装飾のためでもあるので、選ぶたびに窓が開くと邪魔になる (今の HTML リーダーの「本文を編集」中と同じ振る舞い)。

- 答えのタグにも `concept` `category` を書かせる。先回りの補足と同じように「知ってる」が効く
- ドラッグして聞いた補足は、出典が無くても表示する (読み手が自分で聞いたものなので)。上限 20 個にも数えない
- 先回りの補足を作っている最中でも聞ける。どちらも同じベースから fork するだけ

## 描画

ページの DOM は書き換えない。Notion の本文は閲覧中も `contenteditable` のエディタだからだ。語句を `<span>` で包むと、Notion の描き直しで消えるうえ、編集したときに拡張の要素が本文として保存されるおそれがある。

| 要素 | 描き方 |
|---|---|
| 語句の印 | CSS Custom Highlight API (`CSS.highlights`) で、Range に下線と薄い背景色を付ける |
| ポップオーバー | 最前面の層 (Shadow DOM) に出す。ホバーの判定は Range の `getClientRects` で行う |
| セクション | 印をクリックすると、その段落の直下に重ねてカードで開く。本文には差し込まない |
| リンク | 印をクリックすると出典を新しいタブで開く |
| 小窓 | 最前面の層に出す (今の小窓と同じ操作) |

- 補足の中身は今の `sanitize` と同じ許可タグだけにして、Shadow DOM の中に描く
- スクロール、サイズ変更、DOM の変化 (`MutationObserver`) のたびに、Range を探し直して層の位置を合わせる。処理は `requestAnimationFrame` でまとめる
- 位置の探し方 (付け直し) は、DOM ではなく「本文の文字列 + テキストノードの開始位置の表」で解く関数にする。Node のテストでそのまま試せる

### 「知ってる」と戻す

- ポップオーバーとカードに「知ってる」ボタンを付ける
- 押すと概念を `category` のプロフィールに足す (`label` と本文での表記を別名に入れる)。補足のレコードは書き換えない。表示がプロフィールで絞り込まれるので、その場で消える
- 画面下に「『楽観ロック』を知ってるにしました [戻す]」のトーストを 8 秒出す。「戻す」で概念を抜くと、補足はそのまま戻る。補足は作り直さない
- 「知ってる」をレコードに書かないのは、どのページから戻しても全ページで元に戻るようにするため (ページ A で知ってるにして、ページ B のプロフィール一覧から戻した場合も)
- サイドパネルの「プロフィール」タブで、区分ごとの一覧と検索、1 件ずつ戻すことができる

## サイドパネル

タブを切り替えると、そのタブのページの内容に切り替わる。

- **書き込み履歴**: 1 回の実行・1 回の質問ごとにまとまる。見る / 取り消す / ポップオーバー ↔ セクションの変換 (今の右ペインと同じ。取り消しと変換は `page.json` のレコードを消す・書き換える)
- **承認待ち**: 既存の補足と重なったもの。「セクションとして追加」か「捨てる」
- **見つからなくなった補足**: `orphaned` のもの。捨てる
- **状態**: 作成中の進み具合、出典なしで捨てた数、本文を切った知らせ、エラーと「やり直す」
- **プロフィール**: 上記

## オプション

- 許可リスト (`pattern` と本文の根の `root`)。追加すると、そのサイトへのアクセス権を `optional_host_permissions` から求める
- モデル (`haiku` / `sonnet` / `opus`、既定は `haiku`)

許可リストに無いページでは、ツールバーのボタンで実行する (`activeTab` + `scripting`)。ローカルの `file://` を使うときは、拡張の設定で「ファイルの URL へのアクセス」を有効にする。

## 失敗したとき

| 状況 | 振る舞い |
|---|---|
| host が未登録 | サイドパネルに `host/install.sh` を実行するよう出す (コピーできるコマンド付き) |
| `claude` が未ログイン・失敗 | stderr の 1 行を出し、「やり直す」を付ける。途中まで作れた補足は残す |
| 付け直せない | `orphaned` にする (上記) |
| タグが閉じていない | 閉じたぶんだけ使い、残りは捨ててログに残す |
| `data/` がコミット対象 | host が起動を拒否する (下記) |

## 知識プロフィールを漏らさないための検査

`data/profile/work.json` には社外に出せない業務知識が入る。このリポジトリは公開されている。`.gitignore` の `data/` だけに頼らない。

host は起動のたびに `guard.js` で次を確かめ、ひとつでも外れたら何もせずに理由を返して終わる。

1. `DATA_DIR` が git の作業ツリーの中にあるなら、`git check-ignore -q <DATA_DIR>/profile/work.json` が成功する (無視されている)
2. `git ls-files <DATA_DIR>` が空である (過去にコミットされていない)

`DATA_DIR` は環境変数 `UBIQDOC_DATA_DIR` で変えられる (既定はリポジトリの `data/`)。

## テスト

| 層 | 対象 | 方法 |
|---|---|---|
| 単体 | タグの読み取り (逐次読み取り、`concept` / `source` 属性)、概念キーの正規化、索引の照合、付け直し、native messaging の枠、`guard.js` | `node:test` (依存なし) |
| host の結合 | 開く → 3 段 → 知ってる → 戻す → 本文が変わって付け直し | `UBIQDOC_CLAUDE_BIN` で `claude` を決まった答えを返すスタブに差し替える |
| E2E | 描画、ホバー、セクションのカード、知ってる、トーストの戻す、付け直し、ドラッグして聞く | isolated の Playwright で拡張を読み込む。見本はローカルの HTML と、Notion をまねた `contenteditable` のページ |
| 手動 | 本物の Notion と GitHub | 自動化しない |

HTML リーダーは、`core/` に切り出したあとも今のまま動くことを、既存の操作 (開く、聞く、取り消す、変換) で確かめる。

## 移行

1. このリポジトリを正とする。LaunchAgent `com.atsushi.ubiqdoc.dashboard` の実行先をこのリポジトリの `server.js` に向け直す
2. 別の場所に置いていた作業用のコピーの `data/` を、このリポジトリの `data/` に移す
3. 作業用のコピーは畳む

## README

「Chrome 拡張として使う」の節を足す (インストール、`host/install.sh`、許可リスト、知識プロフィールの置き場と、コミットされないことの説明)。HTML リーダーの節はそのまま残す。
