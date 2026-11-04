# Explore 3D — luvas.io

Browser viewer for three rooms of the Institute of Computing (Unicamp) reconstructed from video by
the MO446 Computer Vision pipeline (Trabalho 2): structure from motion with COLMAP, metric scale
from a printed checkerboard, room planes by RANSAC, PatchMatch multi-view stereo and Poisson
meshing. Pick room A, B or C, then orbit around it, cut away the ceiling and the front wall, walk
the capture path, measure between two points and read the metrics. Write-up (in Portuguese) in
[frontend/README.md](frontend/README.md).

## Structure

```
api/            Express server that serves the compiled app (deploy stage)
frontend/       Angular 22 application; public/scenes/ holds the converted reconstructions
```

## Development

```sh
cd frontend
npm install --legacy-peer-deps
npm start             # dev server on http://localhost:4200
npm run build         # production build to dist/v1/browser
npm test -- --watch=false && npm run e2e
npm run scenes        # re-export public/scenes/ from the pipeline results (T2_RESULTS=...)
```

## Deploy

Same standard as the other luvas.io apps (multi-stage Docker build, Express serving the compiled
bundle):

```sh
docker compose up --build -d   # serves on port 7140
```
