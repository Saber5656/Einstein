# Einstein

画像を読み込み、顔を検出して全員が舌を出しているように編集するブラウザアプリです。

- 写真はブラウザ内で処理
- 複数人の顔を自動検出
- 舌の大きさ・長さ・スタイルを調整
- 検出漏れは手動追加
- PNG保存

## Live deployment

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/Saber5656/Einstein)

Netlify設定はリポジトリ直下の `netlify.toml` にあり、`dist/` をそのまま公開します。ビルド処理は不要です。

## Repository structure

```text
dist/
  index.html
  app.js
  styles.css
netlify.toml
```

`main` を正本として管理します。
