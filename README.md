# Meshy Turntable

A small, browser-based studio for turning GLB models into shareable turntable
animations. Built with React, TypeScript, Three.js, and Vite.

Created by **128629Git** with AI-assisted development. This standalone source
release can run without ChatGPT Sites, Cloudflare, a server database, or API keys.

## Features

- Load a self-contained GLB by browsing or dragging it into the preview.
- Orbit and zoom, with synchronized model rotation in the preview and exports.
- Set a full rotation to 2–12 seconds.
- Choose pure white, pure black, or no background.
- Export Classic GIF or full-color animated WebP.
- Review the actual encoded file before downloading it.
- Capture the current angle as a transparent PNG.
- Center and fit the complete rotation using Tight, Balanced, or Roomy margins.
- Adjust exposure and save named presets in this browser.
- Export a batch one model at a time, retry failed items, or stop and keep
  completed outputs. Download individual results or one ZIP.

## Run locally

Install **Node.js 22.13 or newer** (Node 22 LTS is a convenient choice), then run
these commands from the project folder:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Choose a GLB with embedded textures.
No account or service credentials are required by the application.

## Make your first export

1. Load a GLB and choose the camera angle.
2. Choose a framing margin or press **Center & fit**.
3. Choose the background, duration, light level, format, and quality.
4. Press **Create GIF preview** or **Create WebP preview**.
5. Inspect the finished file and press **Download**.

For a still image, pause live rotation and press **Capture transparent PNG**.
The PNG always omits the background and floor, irrespective of the background
selected for animation.

For a collection, use **Add GLBs** in Batch export. The batch takes one snapshot
of your current settings and fits each model independently. Completed files are
kept when a batch is stopped. Use **Reset exports** to apply changed settings to
already-completed items.

## Output presets

| Quality | Dimensions | Frames per rotation |
| --- | --- | --- |
| Clean | 480 × 480 | 48 |
| Detailed | 640 × 640 | 64 |
| Maximum | 720 × 720 | 96 |

GIF has a limited color palette and one-bit transparency. Smooth gradients can
show bands, and opaque GIFs use dithering. WebP supports full color and smoother
alpha edges; this app requests high-quality lossy RGB encoding from the browser.
It is not a lossless RGB export. Some upload destinations do not accept animated
WebP, even when browsers can display it.

The GIF frame delays are distributed in centiseconds so the whole rotation keeps
the requested duration. WebP uses millisecond timing. Both render the same model
rotation with the same lighting. Playback performance still depends on the device.

## Build and host

```sh
npm run build
npm run preview
```

Publish the contents of `dist/` on a static web host such as Netlify or GitHub
Pages. The default relative asset paths also work in a subdirectory. If your host
requires an explicit base path, build with:

```sh
npm run build -- --base=/meshy-turntable/
```

The GIF worker uses the configured base path. Serve the app over HTTP or HTTPS;
opening `index.html` directly as a `file://` URL is not supported. This repository
does not automatically deploy anywhere.

## Tests

The regression tests need Node.js plus Python 3.9+ with Pillow. Python is only
needed for tests; the app itself runs entirely in the browser.

```sh
python3 -m pip install Pillow
npm test
```

On Windows, use `python -m pip install Pillow`. Set the `PYTHON` environment
variable to select a different Python executable if needed.

Tests cover GIF/WebP timing, saved-settings validation, framing over complete
rotations, off-origin GLB pivots, sequential batch cleanup, cancellation,
independent ZIP extraction, and the actual GIF worker's encoded duration.

## Privacy and limitations

- The application does not upload selected models to a processing server.
- Use self-contained GLBs: externally referenced textures can cause the GLTF
  loader to request their URLs. Compressed-model extensions such as Draco/KTX2
  are not configured in this release.
- Presets and last-used settings are stored in localStorage on the current device.
  Models, outputs, and unfinished batches are not persisted across reloads.
- WebGL is required. Native WebP encoding support varies by browser; the app
  shows an error and suggests Classic GIF when WebP export is unavailable.
- Large models and batches can consume substantial memory. Processing is
  sequential, but completed encoded files stay available until cleared/reloaded.
- Embedded animation clips are not played; this is a model turntable.
- No model files, example artwork, hosting credentials, or account configuration
  are included in the source release.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues with reproducible steps and small
GLB examples you have permission to share are welcome.

## License

[MIT](LICENSE). You may use, modify, redistribute, and use the software
commercially while retaining the copyright and license notice. Third-party
code retains its own notices; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
The code license does not grant rights to anyone's separately supplied models
or artwork. This project is not affiliated with or endorsed by Meshy.
