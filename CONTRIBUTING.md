# Contributing to ナマエ / Namae

Thanks for taking an interest in Namae. The project is an experimental agent prototype for turning a hard-to-describe perception into discoverable terminology and useful destinations.

## Development setup

1. Clone the repository.
2. Copy `.env.example` to `.env` and configure either AI Studio or Vertex AI.
3. Run `npm run dev`.
4. Run `npm test` and `npm run check` before opening a pull request.

The project intentionally uses Node.js built-ins and currently has no runtime package dependencies.

## Good contribution areas

Contributions are especially useful around:

- separating explicit questions from open-ended "what is this feeling called?" discovery;
- evaluation cases for naming accuracy, novelty, and abstention;
- more reliable grounding and destination verification;
- multimodal test coverage;
- deployment and privacy hardening;
- accessibility and documentation.

See `ROADMAP.md` for the current maintenance direction.

## Design principles

Please preserve these boundaries unless a change explicitly proposes a different product contract:

- Perception comes before naming so early labels do not anchor later search.
- Unsupported or ambiguous claims should be surfaced rather than silently invented.
- The auditor may reject candidates and trigger another search pass.
- Users should be able to see uncertainty and possible failure modes.
- The agent discovers and explains; it does not take irreversible actions for the user.

## Pull requests

Keep pull requests focused. In the description, include:

- the problem being solved;
- the behavior before and after the change;
- how you tested it;
- any change to model prompts, data handling, or external-service behavior.

Do not commit API keys, credentials, personal media, or private user inputs. Local successful-run recordings are written to an ignored `fixtures/last-run.local.json` file.

## License

By contributing, you agree that your contributions will be licensed under the repository's MIT License.
