# Proposed README addition

For the README owner to apply separately. The frozen demo and video stay unchanged.

## Fine-tuned optimizer experiment

A separate, completed evaluation compared base Nemotron Nano 8B with three saved LoRA adapters on 20 new synthetic factories. The original-data, three-epoch adapter lowered mean objective 36.76% versus base and reached the unchanged full goal on 10/20 factories, versus 1/20 for base. Total damaged packages fell from 963 to 427 across 80 final demand days. It did not achieve zero damage everywhere; the new-data one-epoch adapter did not beat the random-move reference on mean objective.

The evaluator and model server ran together on a temporary Crusoe A100, independent of SSH. All 948 requests resolved, and the independent audit replayed 4,936 simulator evaluations. VM and disk deletion were verified; estimated usage was $0.72 against a $3 cap, with the posted invoice unverified. No retraining occurred in this evaluation run.

See [full evidence](docs/evidence/optimizer-v3-results.md), [independent audit](docs/evidence/optimizer-v3-audit.json), and the separate local comparison at `http://127.0.0.1:5194/`. The archived one-epoch run and later three-epoch run do not perfectly isolate the effect of epoch count from training randomness. These are synthetic-factory results.
