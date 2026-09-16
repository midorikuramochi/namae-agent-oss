# Roadmap

Namae began as a time-boxed hackathon prototype. The goal of this roadmap is to turn the useful parts of that prototype into a small, inspectable open-source reference project rather than to imply production readiness.

## Near term

- **Question vs. discovery routing** — detect when the user is asking for a concrete identification (for example, “what instrument is this?”) and avoid filtering out the correct answer merely because it is already well known.
- **Evaluation set** — add reproducible text, image, audio, and YouTube cases covering correct identification, useful novelty, false-positive terminology, abstention, and retry behavior.
- **Grounding verification** — make destination/source validation more explicit and measurable.
- **Multimodal regression coverage** — test timestamp extraction, media fallbacks, and failure handling without requiring live API calls for every test.

## Deployment and maintenance

- Add a documented Cloud Run reference deployment.
- Document data flow and retention assumptions for uploaded media and generated traces in more detail.
- Extend verification beyond deterministic unit checks to provider-aware integration cases where appropriate.
- Track model/API changes that affect structured output, Google Search grounding, and YouTube/media handling.

## Longer-term exploration

- Compare the four-stage pipeline against a strong single-agent baseline.
- Evaluate whether “novelty” should be personalized from explicit user knowledge instead of approximated through general popularity.
- Explore provider-agnostic interfaces for perception, grounded naming, auditing, and navigation.

Roadmap items are directions, not commitments or claims of current functionality.
