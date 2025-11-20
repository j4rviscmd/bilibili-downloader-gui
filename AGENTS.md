# AGENTS.md - リポジトリ運用ガイド (Project + Global)

このファイルは bilibili-downloader-gui 専用ルール + 共通グローバル基準 (~/.config/opencode/AGENTS.md) を統合した運用ガイドです。
まずセクション A にグローバル基準を全文転載し、続いてセクション B に本プロジェクト特有ルールを定義します。

## A. グローバル開発ガイドライン

### 1. 承認 / 権限

- すべてのコード変更は事前に Issue / PR 上で合意。口頭のみ不可。
- "ユーザの許諾" = 対象リポジトリのメンテナ(OWNER もしくは CODEOWNERS 該当者) の GitHub Review "Approved"。
- 緊急 hotfix: Issue に `hotfix` ラベル + 原因 / 暫定対策 / 恒久対策案記載。マージ後 24h 以内に事後レビュー。
- Self-merge 禁止 (hotfix 例外時も事後レビュー必須)。

### 2. ブランチ戦略

- `main`: 常にデプロイ可能。直接 push 禁止。保護設定。
- 機能: `feature/<短い-kebab-case>`。
- バグ修正: `fix/<issue番号-概要>`。
- リリース調整: `release/<version>` (必要時)。
- 緊急: `hotfix/<issue番号>`。

### 3. コミット規約 (Conventional Commits)

- 型: `feat`, `fix`, `docs`, `style` (フォーマットのみ), `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`。
- 先頭は型 + オプション範囲: `feat(api): ...`。
- 目的を簡潔に (WHY に近い WHAT)。
- 破壊的変更はフッターに `BREAKING CHANGE: <内容>`。
- 生成物/ビルド成果物 (`dist`, `coverage`, `.DS_Store`, ローカル設定) 非コミット。
- コミット前に `lint` & `format` & (該当差分の) `test` 実行。失敗した場合はコミット中断し修正。

### 4. CI 成功基準

- 必須ジョブ: Lint / Unit Test / Build / (設定あれば) Security Scan / Type Check。
- すべて成功かつレビュー承認後のみ `main` へマージ。
- CI 失敗を無視したマージ禁止 (hotfix でも最低限ビルドと該当テストが通ること)。

### 5. テストポリシー

- 新規 / 変更ロジックは最低 1 つの自動テスト (単体 or 統合)。
- ステートフル/副作用コードはテストで可観測性を確保 (モックか外部接続分離)。
- カバレッジ目標: Statements 80% / Branches 70% を下回る PR は改善コメント付与。
- 例外 (PoC / 実験) は Issue に理由を明記し後続タスク化。

### 6. 提案プロセス

- ベストプラクティスに基づく提案は Issue で: 背景 / 目的 / 代替案 / コスト / リスク / 影響範囲。
- 採用可否はメンテナがコメントで明確化。曖昧な保留状態を避ける。

### 7. コミュニケーション言語

- 会話 / レビュー / Issue / PR は原則日本語。
- 例外: 外部 OSS 連携・英語のみドキュメント参照時。英語使用箇所は要約を日本語追記。

### 8. セキュリティ / Secrets

- Secrets/APIキーはコード直書き禁止。`.env*` は Git 追跡外 + サンプル `env.example` を提供。
- 誤って漏洩コミットした場合: 直ちにキー再発行し該当コミットを history から除去 (可能なら) + 事後報告 Issue。
- PII/機密をログ/エラーメッセージへ出力禁止。

### 9. 依存パッケージ更新

- 定期 (月次) に脆弱性スキャンと minor/patch 更新。
- 重大 CVE は即日更新。PR 説明に CVE ID、影響、テスト結果記載。
- Renovate / Dependabot 導入時は自動生成 PR のレビュー必須。

### 10. バージョニング & リリース

- SemVer 準拠: MAJOR(破壊) / MINOR(後方互換追加) / PATCH(修正)。
- リリース時: Tag `v<version>` + CHANGELOG 更新 (Conventional Commits から自動生成推奨)。
- BREAKING CHANGE ある場合は移行手順を CHANGELOG に明記。

### 11. コメント / TODO ライフサイクル

- 未解決タスク: `TODO(#<issue>): 説明` / `FIXME(#<issue>):` 形式で必ず Issue 紐付け。
- 解決後: 該当 Issue Close → コメント削除 OK。履歴の誤認を避けるため紐付けないコメントは禁止。
- 自動整形やリファクタでも未解決コメントは削除/改変不可。

### 12. ドキュメント更新 (公開 API)

- 公開 API を追加/変更/廃止する PR は README も更新し、利用例と影響 (互換性/移行手順) を記載。
- ドキュメント未更新の API 変更はマージ不可。

### 13. 作業ログ / 再現性

- 手動手順 (環境構築/移行) を実施した場合は Issue/PR に手順を書き残す。CI 化可能性を検討。

### 14. 遵守違反への対応

- 初回: レビューコメントで是正要求。
- 再発 / 重大: メンテナがガイド再周知 → 必要なら改善 Issue 化。

### 15. 変更方法

- 本ガイド改訂は `docs` もしくは `chore` コミットにて PR 作成。要約と理由を記載。

## B. プロジェクト特有ルール (bilibili-downloader-gui)

### 1. アーキテクチャ境界

- フロント (React/Redux) は表示・入力制御 / 軽い整形に留め、重い処理（並列 DL / ファイル操作 / ffmpeg 呼び出し）は Rust (Tauri) 側へ委譲。
- `src-tauri/src/handlers` は Tauri コマンド実装のみ。ビジネスロジック肥大化時は `services/` 追加を Issue で協議。
- `main.rs` は初期化とコマンド登録のみで極力薄く維持。

### 2. 命名規約 (Frontend)

- Redux slice: `<domain>Slice.ts`。型は `types.ts`。Hooks は `use<Domain>.ts[x]`。
- コンポーネント: PascalCase。UI primitives (`src/components/ui/`) は既存命名準拠。
- 汎用ユーティリティ: `src/lib/utils.ts`。ドメイン固有は `features/<domain>/utils.ts`。

### 3. 命名規約 (Rust)

- ハンドラ: `#[tauri::command] pub async fn <verb>_<object>(...)`。
- エラー型: `Result<T, crate::models::Error>` 統一。設計変更は Issue 協議。
- `models` = DTO / 構造体, `utils` = 補助, `handlers` = コマンド実装。

### 4. エラーコード / i18n

- 形式: `ERR::<CATEGORY>_<DETAIL>`。追加時は i18n JSON / README Error Codes 更新。
- 互換削除は 1 バージョン猶予 (Deprecated → 次 MINOR で削除)。

### 5. ログ / セキュリティ

- Cookie / 認証系値をログ出力禁止。`cookie.rs` 変更時はレビュー強化。
- 衝突警告ログはパス全体でなくファイル名 + 種別のみ。
- ffmpeg 失敗は要約 + exit code のみ返却。

### 6. フォーマット / 静的解析

- 推奨事前チェック: `npm run lint && npm run typecheck` / `cargo fmt -- --check` / `cargo clippy -- -D warnings`。
- `#[allow(...)]` 追加時は PR 説明に理由必須。理由なしは禁止。

### 7. テスト配置

- Frontend: `features/<domain>/__tests__/*.(test|spec).tsx`。UI は Testing Library。ロジックは Vitest (導入後)。
- Rust: 単体テストは同ファイル末尾 `#[cfg(test)]`、横断は将来 `src-tauri/tests/`。
- 外部 API はモック。免除は `test-required` ラベル付き Issue。

### 8. パフォーマンス / 並列ダウンロード

- 同時ダウンロード上限 (初期値 3) を settings slice 管理。変更は Issue。
- 並列制御は `concurrency.rs` に集約。他箇所で直接 spawn 禁止。
- 進捗 emit 間隔は ≥500ms。

### 9. Queue / 進捗表示

- Queue 状態は `shared/queue/queueSlice.ts` が単一ソース。重複 state 層禁止。
- イベント命名: `progress::<id>::tick|done|error`。

### 10. Release / バージョン

- CHANGELOG 自動生成 + 重要差分手動追記。
- 署名/公証手順は Release PR に記載し再現性確保。

### 11. 破壊的変更手順

- Export / Hook / Command 廃止: Deprecated Wrapper → README 注記 → 次 MINOR で削除。

### 12. Issue ラベル

- 使用ラベル例: `type:feature`, `type:bug`, `type:refactor`, `type:docs`, `priority:high`, `security`, `test-required`, `hotfix`, `blocked`。
- `blocked` は解除条件コメント必須。

### 13. 新規依存導入審査

- 単用途は標準機能/既存 util 優先。追加は Issue に 動機/代替/サイズ/メンテ状況/リスク を記載。
- Rust crate 最終更新 >1 年は慎重採用。採用時理由必須。

### 14. 国際化 (i18n)

- 新規キーは英語 + 日本語必須。他言語は英語コピーでフォールバック。
- 意味変更 / 表現改善を PR 説明で区別。

### 15. UI コンポーネント拡張

- Atom/Primitive は `src/components/ui/`、複合ロジックは `components/lib/` か `features/<domain>/`。
- アニメーション系は `components/animate-ui/` に統一。

### 16. ダウンロード衝突

- ファイル名衝突処理改善 (ダイアログ/自動採番戦略) は Issue で協議。Rust 側のみで判定。

### 17. 非同期エラー処理

- Frontend: 例外は toast/Dialog 必須。`console.error` 単独禁止。
- Rust: `anyhow` 導入は別途設計 Issue。

### 18. 依存更新テスト

- アップデート PR は 起動 / フォーム送信 / 1 件 DL / 言語切替 の手動確認ログ添付。

### 19. 追跡不能コード禁止

- window 直書きキャッシュ等の隠し状態禁止。Redux / Context 経由で可観測性維持。

### 20. 一時デバッグ出力

- `console.log` / `dbg!` / `println!` は PR 前除去。恒久的必要なら Logger 層導入を Issue 化。
