# ナマエ / Namae

**Give a name to what you can feel but cannot search for.**

ナマエは、言葉にしきれない感覚・音・見た目を、**実在する検索可能な名前**へ変換し、その名前から辿れる行き先まで返す実験的なAIエージェントです。

> People cannot search for a thing when they do not know what it is called. Namae turns a rough perception into candidate terminology, audits those candidates, and gives the user a path to keep exploring.

This repository started as an individual prototype at a Zenn × Google Cloud mini-hackathon. It is now being cleaned up as a small open-source reference project. It is **not a production service**.

## Why Namae

「弦を弾いた直後に、金属っぽい余韻が長く残る音」

「肩が落ちて、腰から下が直線的に落ちる服」

感覚はあるのに、それを指す語彙がないと検索窓に何を入れればよいか分かりません。Namaeはこの「検索以前」の問題を扱います。

## Agent pipeline

Namae separates the workflow into four stages with different prompts and responsibilities.

| Stage | Role | What it does | Design intent |
|---|---|---|---|
| 1. Perceive | 知覚 | Converts text / image / audio / video into a description of observable phenomena | **Expert terms are forbidden** here so an early label does not anchor the rest of the search |
| 2. Name | 命名 | Searches for real terminology matching that description | Looks for vocabulary used by practitioners rather than only broad category labels |
| 3. Audit | 監査 | Checks existence, fit, and usefulness, then narrows candidates | If too few candidates survive, it writes a new search instruction and sends the task back to stage 2 |
| 4. Navigate | 行き先 | Finds pages and search terms that let the user continue exploring | The output should be actionable, not just a list of labels |

### Agentic behavior in the prototype

- **Audit → re-search:** the auditor can reject insufficient candidates and issue a new search query.
- **Tool fallback:** when Google Search grounding is unavailable because of quota/rate limits, the system can fall back to model knowledge while clearly reducing its evidence claims.
- **Human clarification:** when the input is too underspecified to proceed responsibly, the pipeline can stop and ask the user a question.
- **Uncertainty is visible:** results include confidence and an explicit “how this could be wrong” field.

## Inputs

The current prototype accepts:

- text;
- images / screenshots;
- audio files;
- video files;
- YouTube URLs, including timestamp references such as `6:01` or `1:23:45`.

## Quick start

### 1. Clone

```bash
git clone https://github.com/midorikuramochi/namae-agent-oss.git
cd namae-agent-oss
```

### 2. Configure a model endpoint

Copy the example environment file:

```bash
cp .env.example .env
```

For **Google AI Studio**, set:

```dotenv
GEMINI_API_KEY=your-key
```

For **Vertex AI**, authenticate with Application Default Credentials and set the project instead:

```bash
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT=your-project-id
export GOOGLE_CLOUD_LOCATION=global
```

### 3. Run

```bash
npm run dev
```

Open <http://localhost:8080>.

The project currently uses Node.js built-ins only and has no runtime npm dependencies.

## Verification

Deterministic checks do not require a live Gemini call:

```bash
npm test
npm run check
```

The live agent path still depends on the configured Gemini / Vertex AI service, quota, model availability, and Google Search grounding behavior.

## Guardrails and design boundaries

- Do not invent terminology or URLs when there is not enough evidence.
- Show uncertainty instead of presenting subjective naming as certain identification.
- Use attached media only for the naming task.
- Stop and ask when a missing detail would materially change the answer.
- Keep discovery separate from irreversible user actions; Namae does not purchase, publish, or otherwise act on the user's behalf.

## Privacy notes

This is a local prototype, not a hardened multi-user service.

- Uploaded media is sent to the model endpoint configured by the operator.
- The server does not intentionally persist uploaded media files.
- Successful runs may save the user's text input and agent trace locally to `fixtures/last-run.local.json` so replay mode can demonstrate the last successful run.
- `fixtures/last-run.local.json` and `.env` are gitignored. Do not use sensitive personal media or private inputs when developing or demonstrating the project unless you understand the configured provider's data handling.

## Known limitations

- The prototype currently treats “discover a name I do not know” and “identify the correct answer to my explicit question” too similarly. A popularity/novelty filter can therefore reject the correct answer in direct-identification cases.
- The proof domain is exploratory naming, not general factual search.
- Google Search grounding and multimodal behavior depend on model/API availability and quotas.
- Audio input exists in the implementation but was not fully validated during the original hackathon because API credit ran out.
- A production Cloud Run deployment and production-grade authentication, abuse prevention, observability, and retention controls are not included yet.

See [`ROADMAP.md`](ROADMAP.md) for the maintenance direction.

## Repository structure

```text
public/index.html        browser UI
server.mjs               local HTTP/SSE server
src/agent.mjs            four-stage agent pipeline
src/gemini.mjs           AI Studio / Vertex AI transport
src/replay.mjs           transparent replay mode
fixtures/                 demo fixtures
test/                     deterministic tests
```

The original hackathon pitch materials are preserved in `PITCH.md`, `CARD.md`, and `WORKSHEET.md` as project history. They should not be read as claims of production readiness.

## Contributing

Contributions and issue reports are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT — see [`LICENSE`](LICENSE).
