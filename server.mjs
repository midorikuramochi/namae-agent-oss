import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { runAgent, MODELS } from "./src/agent.mjs";
import { runReplay } from "./src/replay.mjs";
import { listModels } from "./src/gemini.mjs";

const PORT = process.env.PORT || 8080;

async function readBody(req, limit = 25 * 1024 * 1024) {
  const chunks = []; let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw new Error("リクエストが大きすぎます（添付は25MB以下にしてください）");
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
      const html = await readFile(new URL("./public/index.html", import.meta.url));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    if (req.method === "GET" && req.url === "/api/health") {
      const models = await listModels();
      const has = (m) => models.includes(m);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({
        ok: true, text: MODELS.text, image: MODELS.image,
        textAvailable: has(MODELS.text), imageAvailable: has(MODELS.image),
        imageModels: models.filter((m) => m.includes("image")),
      }, null, 2));
    }

    if (req.method === "POST" && req.url === "/api/run") {
      const body = JSON.parse(await readBody(req));
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      // 成功した実行はローカル専用ファイルへ保存する。
      // ユーザー入力を誤ってコミットしないよう、保存先は .gitignore 済み。
      const recorded = [];
      const emit = (o) => {
        if (!body.replay) recorded.push(o);
        res.write(`data: ${JSON.stringify(o)}\n\n`);
      };
      try {
        if (body.replay) await runReplay(emit);
        else {
          await runAgent({ message: body.message || "", media: body.media || null }, emit);
          if (recorded.some((e) => e.type === "done")) {
            await mkdir(new URL("./fixtures/", import.meta.url), { recursive: true });
            await writeFile(new URL("./fixtures/last-run.local.json", import.meta.url),
              JSON.stringify({ message: body.message, events: recorded }, null, 2));
          }
        }
      } catch (e) {
        console.error(e);
        emit({ type: "error", message: String(e.message || e) });
      }
      return res.end();
    }

    res.writeHead(404).end("not found");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});

server.listen(PORT, () => console.log(`\n  Namae Agent → http://localhost:${PORT}\n`));
