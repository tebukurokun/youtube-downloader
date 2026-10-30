export function UsageGuide() {
  return (
    <section className="usage-guide" aria-label="使い方">
      <h2>使い方</h2>
      <ol>
        <li>
          YouTube の動画URL（<code>youtube.com/watch?v=…</code>、<code>youtu.be/…</code>、
          <code>/shorts/…</code>
          ）を貼り付けて「解析」を押します。
        </li>
        <li>保存形式（動画 / 音声 MP3）と画質を選び、「ダウンロード開始」を押します。</li>
        <li>完了したら「ファイルを保存」でパソコンに保存します。</li>
      </ol>
      <ul className="usage-notes">
        <li>ダウンロードは1件ずつです。途中でキャンセルできます。</li>
        <li>完成ファイルは保存後、または30分後にサーバーから自動で削除されます。</li>
        <li>
          プレイリスト・ライブ配信・ログインが必要な動画（メンバー限定・年齢制限など）には対応していません。
        </li>
      </ul>
    </section>
  );
}
