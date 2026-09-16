import { readFile } from "node:fs/promises";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gsearch = (q) => "https://www.google.com/search?q=" + encodeURIComponent(q);

async function readReplayFixture() {
  const candidates = [
    new URL("../fixtures/last-run.local.json", import.meta.url),
    new URL("../fixtures/last-run.json", import.meta.url),
  ];
  for (const path of candidates) {
    try { return JSON.parse(await readFile(path)); } catch { /* try next */ }
  }
  return null;
}

// 実行済みの結果をそのまま再生する。ライブAPIが使えない時の保険。
// UI側に replay:true を伝えるので、画面上に必ず「録画」と表示される。
// ローカルの直近成功実行 → リポジトリ同梱デモ → 手書きフィクスチャの順に戻る。
export async function runReplay(emit) {
  const fx = await readReplayFixture();
  if (fx) {
    emit({ type: "replay", message: fx.message });
    for (const e of fx.events) {
      if (e.type === "step" && e.status === "running") await sleep(1200);
      emit(e);
    }
    return;
  }
  return runFixture(emit);
}

async function runFixture(emit, fixturePath = "./fixtures/demo-fashion.json") {
  const fx = JSON.parse(await readFile(new URL(fixturePath, import.meta.url.replace("/src/", "/"))));
  const t0 = Date.now();
  const ms = () => Date.now() - t0;

  emit({ type: "replay", message: fx.message });

  emit({ type: "step", id: "perceive", status: "running", label: "① 知覚：名前を使わずに「何が起きているか」へ翻訳する" });
  await sleep(1400);
  emit({ type: "step", id: "perceive", status: "done", ms: ms(), detail: fx.percept });

  emit({ type: "step", id: "name1", status: "running", label: "② 命名：Google検索で、あなたが知らない名前を掘り出す" });
  await sleep(900);
  if (fx.grounded === false)
    emit({ type: "decision", text: "Google検索ツールが利用できませんでした。エージェントの判断で、モデル自身の知識から実在する名前を挙げる方式に切り替えます（根拠URLの代わりに、検索窓に打つ語を渡します）。" });
  await sleep(1600);
  emit({ type: "step", id: "name1", status: "done", ms: ms(), detail: { count: fx.names.length, names: fx.names } });

  emit({ type: "step", id: "audit1", status: "running", label: "③ 監査：知りすぎている名前・それらしいだけの名前を落とす" });
  await sleep(1800);
  emit({ type: "step", id: "audit1", status: "done", ms: ms(), detail: { audit: fx.audit, picked: fx.picked.length, rejected: fx.rejected } });

  emit({ type: "results", items: fx.picked, audit: fx.audit, rejected: fx.rejected, percept: fx.percept, sources: [] });

  emit({ type: "step", id: "navigate", status: "running", label: `④ 行き先：${fx.picked.length}個の名前で、実際に辿れるページを探す` });
  await sleep(1500);
  fx.picked.forEach((p, i) => {
    const kinds = ["実例", "解説", "次の一歩"];
    const links = (p.search_terms || []).map((q, k) => ({
      kind: kinds[k] || "次の一歩", title: q, url: gsearch(q), note: "この語で検索すると辿れます",
    }));
    emit({ type: "links", index: i, links });
  });
  emit({ type: "step", id: "navigate", status: "done", ms: ms() });
  emit({ type: "done", ms: ms() });
}
