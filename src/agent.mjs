import { generate, textOf, looseJson, groundingUrls } from "./gemini.mjs";

export const MODELS = { text: "gemini-3.6-flash" };

// Google検索グラウンディングが使えない（無料枠/クォータ超過）ことの検知
const isQuota = (e) => /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(String(e?.message || e));

const GUARDRAIL = `
あなたは「言葉にできない感覚に名前をつける」エージェントの一部です。
絶対に守る制約:
- 実在しない用語・ジャンル名・URLを創作しない。根拠が取れないものは出さない。
- 断定しない。必ず確信度と「外している可能性」を併記する。
- 添付された音源・画像は、名前を特定する目的以外に使わない。
`.trim();

// ---------------------------------------------------------------- YouTube 補助
// youtu.be/XXX や ?si=... を正規化する
export function normalizeYouTube(url) {
  try {
    const u = new URL(url.trim());
    if (u.hostname === "youtu.be") return `https://www.youtube.com/watch?v=${u.pathname.slice(1)}`;
    const v = u.searchParams.get("v");
    if (v) return `https://www.youtube.com/watch?v=${v}`;
    return url.trim();
  } catch { return url.trim(); }
}

// 「6:01」「1:23:45」のような表記を秒に直す。最大3件。
export function parseTimestamps(text) {
  const out = [];
  for (const m of String(text || "").matchAll(/\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/g)) {
    const h = m[1] ? Number(m[1]) : 0;
    const sec = h * 3600 + Number(m[2]) * 60 + Number(m[3]);
    if (!out.includes(sec)) out.push(sec);
    if (out.length >= 3) break;
  }
  return out;
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// ------------------------------------------------ ① 知覚エージェント（Perceiver）
// 名前を出させない。名前で書かせると、この後の探索が本人の語彙の外に出られなくなる。
const PERCEIVE_SCHEMA = {
  type: "object",
  properties: {
    domain: { type: "string" },              // 音 / 見た目 / その他
    phenomena: { type: "array", items: { type: "string" } }, // 起きている現象の記述
    focus: { type: "string" },               // 本人が特に惹かれている一点
    qualities: { type: "array", items: { type: "string" } }, // 質感・印象を表す語
    known_words: { type: "array", items: { type: "string" } },// 本人が既に使っている語
    assumed: { type: "array", items: { type: "string" } },
    missing_critical: { type: "array", items: { type: "string" } },
    question_to_user: { type: "string" },
  },
  required: ["domain", "phenomena", "focus", "qualities", "assumed", "missing_critical"],
};

async function stepPerceive({ message, media }) {
  const parts = [];
  let mediaNote = "添付はありません。";
  if (media?.kind === "inline") {
    parts.push({ inlineData: { mimeType: media.mime, data: media.data } });
    mediaNote = media.mime.startsWith("audio")
      ? "添付は音源です。実際に聴いて、どんな音が鳴っているかを記述してください。"
      : media.mime.startsWith("video")
      ? "添付は動画です。映像と音の両方を確認して、何が起きているかを記述してください。"
      : "添付は画像です。実際に見て、何が写っているかを記述してください。";
  } else if (media?.kind === "youtube") {
    const uri = normalizeYouTube(media.url);
    const stamps = parseTimestamps(message);
    if (stamps.length) {
      // 指定された時刻の前後だけを切り出して渡す。動画全体を渡すより速く、狙いも外れにくい。
      for (const t of stamps) {
        parts.push({
          fileData: { mimeType: "video/*", fileUri: uri },
          videoMetadata: {
            startOffset: { seconds: String(Math.max(0, t - 3)) },
            endOffset: { seconds: String(t + 12) },
          },
        });
      }
      mediaNote = `添付はYouTube動画の、指定された時刻の前後だけを切り出したものです（${stamps.map(fmt).join("、")}）。
その区間で実際に鳴っている音・映っているものだけを記述してください。区間外のことは書かないでください。`;
    } else {
      parts.push({ fileData: { mimeType: "video/*", fileUri: uri } });
      mediaNote = "添付はYouTubeの動画です。実際に視聴・聴取して記述してください。";
    }
  }

  parts.push({
    text: `この人が「気になっているが、言葉にできていない感覚」を記述してください。

本人の言葉:
${message || "（言葉なし。添付だけ）"}

${mediaNote}

最重要ルール:
- **phenomena と qualities に、専門用語・ジャンル名・楽器名を絶対に書かないでください。**
  この人は名前を知らないからここに来ています。名前を先に書くと、この後の探索が
  その名前の周りだけをぐるぐる回ってしまいます。
  代わりに「何が起きているか」を、素人にも通じる言葉で書いてください。
  例（音）:「弦を弾いた直後に金属的な余韻が長く残る」「低音が輪郭を持たずに空間に広がる」
  例（見た目）:「肩の線を落として、腰から下が直線的に落ちる」「彩度を抑えた色だけで組んでいる」
- focus には、この人が惹かれている一点を1文で書いてください。
- known_words には、本人が文中で既に使っている専門語だけを入れてください。`,
  });

  const system = `${GUARDRAIL}

あなたは「知覚」担当です。音や画像を、名前ではなく“現象の記述”に変換します。
- 曖昧な点は常識的に補い、補ったものを assumed に列挙する。
- 「これが分からないと全く見当違いの名前を出してしまう」項目だけを missing_critical に入れ、
  question_to_user に質問を1つだけ書く。それ以外は勝手に補って前に進む。`;

  const call = (p) => generate({
    model: MODELS.text, system, parts: p,
    responseMimeType: "application/json",
    responseSchema: PERCEIVE_SCHEMA,
    temperature: 0.3,
    timeoutMs: 150000,
  });

  try {
    return looseJson(textOf(await call(parts)));
  } catch (e) {
    // 添付（特にYouTube URL）が原因で落ちた場合、本人の言葉だけで続行する
    if (!media) throw e;
    const textOnly = parts.filter((p) => p.text);
    const r = looseJson(textOf(await call(textOnly)));
    r.assumed = [...(r.assumed || []), "添付を読み取れなかったため、言葉だけで判断しました"];
    return r;
  }
}

// -------------------------------------------- ② 命名エージェント（Namer / Google検索）
async function stepName({ percept, extraQuery }) {
  const q = `
次の「現象の記述」に対応する、実在する名前（専門用語・ジャンル名・楽器名・奏法名・系統名など）を10個挙げてください。

# 領域
${percept.domain}
# 起きている現象
${percept.phenomena.map((p) => "- " + p).join("\n")}
# 質感・印象
${(percept.qualities || []).join("、")}
# 本人が特に惹かれている一点
${percept.focus}
# 本人が既に知っている言葉（これらは"新しい名前"に数えない）
${(percept.known_words || []).join("、") || "（なし）"}
${extraQuery ? `\n# 追加指示（前回の監査で不十分だったため）\n${extraQuery}` : ""}

制約:
- **挙げるべきは「その分野の作り手・職人・専門店の店員が、同業者に対して使う言葉」です。**
  雑誌の見出しやまとめ記事に載るような言葉（例:「ドロップショルダー」「ニュアンスカラー」
  「クワイエット・ラグジュアリー」「Iライン」のような、検索すれば誰でもすぐ辿り着く言葉）は
  **この人はもう通り過ぎています。挙げても価値がありません。**
- 次のどれかに当てはまる、一段深い語彙を優先してください:
  ・特定の年代・地域・ムーブメントの固有名（「◯◯年代の△△」のように歴史に紐づく名前）
  ・構造・技法・素材の専門語（どう作られているかを指す言葉）
  ・海外で使われている原語表記（日本語に訳されずに使われている語）
  ・その分野の中の下位ジャンル名（大分類ではなく、その中の細かい呼び分け）
- **10個挙げ、そのうち7個以上を上記の一段深い語彙にしてください。**
- Google検索で、その名前が実際にその意味で使われていることを確認してから挙げてください。
- 日本語で通用する表記を優先し、原語表記が一般的ならそれも併記してください。

以下のJSON配列だけを \`\`\`json フェンスで返してください。
[{"name":"名前","reading":"よみ/原語","one_line":"何を指す言葉か(45字以内)","matches":"上のどの記述に対応するか(50字以内)","confidence":80,"search_terms":["検索に打つ語1","語2"],"source_url":"根拠URL","obscure":true}]
confidence は0-100。obscure は「一般には知られていない名前」なら true。`.trim();

  const system = `${GUARDRAIL}

あなたは「命名」担当です。
この人が“名前を知らなかったせいで出会えなかった”言葉を掘り出すことが仕事です。
有名な言葉を並べるのは失敗です。`;

  // まずGoogle検索ツールで裏取りを試み、使えなければ内部知識に切り替える
  try {
    const res = await generate({
      model: MODELS.text,
      system: `${system}\nGoogle検索ツールを必ず使い、実在する用語だけを挙げます。`,
      parts: [{ text: q }],
      tools: [{ google_search: {} }],
      temperature: 0.7,
    });
    const items = looseJson(textOf(res));
    return { items: Array.isArray(items) ? items : [], sources: groundingUrls(res), grounded: true };
  } catch (e) {
    if (!isQuota(e)) throw e;
    const res = await generate({
      model: MODELS.text,
      system: `${system}
Google検索は使えません。あなたの知識の中から、確実に実在すると言い切れる用語だけを挙げてください。
自信が持てないものは挙げず、source_url は空文字にしてください。`,
      parts: [{ text: q.replace("- Google検索で、その名前が実際にその意味で使われていることを確認してから挙げてください。",
        "- 実在が確実な用語だけを挙げてください。曖昧なものは挙げないでください。") }],
      temperature: 0.7,
    });
    const items = looseJson(textOf(res));
    return { items: Array.isArray(items) ? items : [], sources: [], grounded: false };
  }
}

// ---------------------------------- ③ 監査エージェント（Auditor / 自律リトライ判断）
const AUDIT_SCHEMA = {
  type: "object",
  properties: {
    picked: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" }, reading: { type: "string" },
          one_line: { type: "string" }, matches: { type: "string" },
          concern: { type: "string" }, confidence: { type: "integer" },
          search_terms: { type: "array", items: { type: "string" } },
        },
        required: ["name", "one_line", "matches", "concern", "confidence", "search_terms"],
      },
    },
    rejected: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, why: { type: "string" } },
        required: ["name", "why"],
      },
    },
    audit: { type: "string" },
    need_research_again: { type: "boolean" },
    retry_query: { type: "string" },
  },
  required: ["picked", "rejected", "audit", "need_research_again"],
};

async function stepAudit({ percept, candidates }) {
  const res = await generate({
    model: MODELS.text,
    system: `${GUARDRAIL}

あなたは「監査」担当です。命名担当が出した候補を検査し、3つに絞ります。
検査項目:
 1. その名前は実在し、挙げられた意味で実際に使われているか
 2. 「起きている現象」に本当に対応しているか（それらしいだけの語を落とす）
 3. 本人が既に知っている言葉（known_words）の言い換えに過ぎないものは落とす
 4. **一般に知られすぎている名前は容赦なく落とす。**
    判定基準:「その分野に特に詳しくない人が、雑誌やまとめ記事で見かけたことがありそうな語か？」
    見かけたことがありそうなら落とす。この人が求めているのは、まだ出会っていない名前です。

- picked は confidence の高い順に3つ。各件に concern（外している可能性）を必ず書く。
- 落とした候補は rejected に理由付きで入れる。
- 検査を通る候補が3つに満たない場合は need_research_again を true にし、
  retry_query に「次はどう探し直すべきか」を具体的に書く
  （例: 隣接ジャンルの語彙で探す、奏法ではなく機材名で探す、年代を変える）。`,
    parts: [{ text: `# 現象の記述\n${JSON.stringify(percept, null, 2)}\n\n# 候補\n${JSON.stringify(candidates, null, 2)}` }],
    responseMimeType: "application/json",
    responseSchema: AUDIT_SCHEMA,
    temperature: 0.2,
  });
  return looseJson(textOf(res));
}

// ------------------------------------ ④ 行き先エージェント（Navigator / Google検索）
const gsearch = (q) => "https://www.google.com/search?q=" + encodeURIComponent(q);

async function stepNavigate({ pick, percept }) {
  const kinds = percept.domain.includes("音")
    ? "1. 実例 … その音が実際に聴ける楽曲・動画\n 2. 解説 … これが何なのかが分かる記事\n 3. 次の一歩 … もっと深く辿れる場所"
    : "1. 実例 … その系統の実例が並ぶページ・ブランド\n 2. 解説 … これが何なのかが分かる記事\n 3. 次の一歩 … もっと深く辿れる場所";

  const system = `${GUARDRAIL}\n\nあなたは「行き先」担当です。`;

  try {
    const res = await generate({
      model: MODELS.text,
      system: `${system}\nGoogle検索ツールを必ず使い、実在するURLだけを返します。`,
      parts: [{ text: `「${pick.name}」について、日本語話者が今すぐ辿れる具体的なページを3つ、Google検索で探してください。
領域: ${percept.domain}
${kinds}

以下のJSON配列だけを \`\`\`json フェンスで返してください。実在するURLだけを挙げ、確認できなければその要素を省いてください。
[{"kind":"実例|解説|次の一歩","title":"ページタイトル","url":"https://...","note":"何が分かるか(30字以内)"}]` }],
      tools: [{ google_search: {} }],
      temperature: 0.3,
    });
    const items = looseJson(textOf(res));
    return { links: Array.isArray(items) ? items.slice(0, 3) : [], grounded: true };
  } catch (e) {
    if (!isQuota(e)) return { links: [], note: String(e.message).slice(0, 160) };

    // 検索できないなら、URLを創作せず「検索窓に打つべき語」を渡す。
    // 名前が分からず検索できなかった人にとって、これ自体が求めていたものでもある。
    const res = await generate({
      model: MODELS.text,
      system: `${system}
Google検索は使えないので、URLは絶対に書かないでください。
代わりに「この人が検索窓に打つべき語」を作ります。`,
      parts: [{ text: `「${pick.name}」（${pick.one_line}）を、これから自分で辿っていく人のために、
Google検索に打ち込む検索クエリを3つ作ってください。領域: ${percept.domain}
${kinds}

以下のJSON配列だけを \`\`\`json フェンスで返してください。
[{"kind":"実例|解説|次の一歩","query":"検索クエリ","note":"これで何にたどり着けるか(30字以内)"}]` }],
      responseMimeType: "application/json",
      temperature: 0.4,
    });
    const items = looseJson(textOf(res));
    const links = (Array.isArray(items) ? items : []).slice(0, 3)
      .map((x) => ({ kind: x.kind, title: x.query, url: gsearch(x.query), note: x.note }));
    return { links, grounded: false };
  }
}

// --------------------------------------------------------------- オーケストレーション
export async function runAgent({ message, media }, emit) {
  const t0 = Date.now();
  const ms = () => Date.now() - t0;

  emit({ type: "step", id: "perceive", status: "running", label: "① 知覚：名前を使わずに「何が起きているか」へ翻訳する" });
  const percept = await stepPerceive({ message, media });
  emit({ type: "step", id: "perceive", status: "done", ms: ms(), detail: percept });

  if (percept.missing_critical?.length && percept.question_to_user) {
    emit({ type: "ask", question: percept.question_to_user, missing: percept.missing_critical });
    return;
  }

  let candidates = [], sources = [], audit = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const extraQuery = attempt === 2 ? audit?.retry_query : null;
    emit({
      type: "step", id: `name${attempt}`, status: "running",
      label: attempt === 1
        ? "② 命名：Google検索で、あなたが知らない名前を掘り出す"
        : `② 命名（再実行）：${extraQuery || "別の語彙圏で探し直す"}`,
    });
    const s = await stepName({ percept, extraQuery });
    candidates = attempt === 1 ? s.items : [...candidates, ...s.items];
    sources = [...new Set([...sources, ...s.sources])];
    if (s.grounded === false && attempt === 1) {
      emit({ type: "decision", text: "Google検索ツールが利用できませんでした。エージェントの判断で、モデル自身の知識から実在する名前を挙げる方式に切り替えます（根拠URLの代わりに、検索窓に打つ語を渡します）。" });
    }
    emit({
      type: "step", id: `name${attempt}`, status: "done", ms: ms(),
      detail: { count: s.items.length, names: s.items.map((x) => x.name) },
    });

    emit({ type: "step", id: `audit${attempt}`, status: "running", label: "③ 監査：知りすぎている名前・それらしいだけの名前を落とす" });
    audit = await stepAudit({ percept, candidates });
    emit({
      type: "step", id: `audit${attempt}`, status: "done", ms: ms(),
      detail: { audit: audit.audit, picked: audit.picked?.length || 0, rejected: audit.rejected || [] },
    });

    if (!audit.need_research_again || (audit.picked?.length || 0) >= 3) break;
    emit({ type: "decision", text: `検査を通った名前が ${audit.picked?.length || 0} 個しかないため、エージェントの判断で探索をやり直します：${audit.retry_query || ""}` });
  }

  const picked = (audit?.picked || []).slice(0, 3);
  emit({ type: "results", items: picked, audit: audit?.audit, rejected: audit?.rejected || [], percept, sources: sources.slice(0, 8) });

  emit({ type: "step", id: "navigate", status: "running", label: `④ 行き先：${picked.length}個の名前で、実際に辿れるページを探す` });
  await Promise.all(picked.map(async (p, i) => {
    const n = await stepNavigate({ pick: p, percept });
    emit({ type: "links", index: i, links: n.links, note: n.note });
  }));
  emit({ type: "step", id: "navigate", status: "done", ms: ms() });

  emit({ type: "done", ms: ms() });
}
