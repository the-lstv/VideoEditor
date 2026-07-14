<img src=https://cdn.extragon.cloud/file/32c0975799f31fc3.svg> <br>
# VideoEditor (in development)
A full-featured, professional, fast and intuitive video & motion graphics editor built with [LS](https://github.com/the-lstv/LS).

Features include (work in progress):
- Entirely hackable
- Highly customizable
- Automation & animation clips
- 3D and VR support*, hardware acceleration & custom shader effects and pipelines
- Intuitive controls to speed up your workflow
- Easy to use, modern, but powerful UI
- Multi-timeline support*
- Highly optimized & lightweight
- Support for a wide variety of formats and codecs
- Subtitle editing, keying, rotoscoping, etc.*
- Advanced audio editing and processing features, MIDI support, and more!*
- And much more!

\* = planned features that are not yet fully implemented.

## A full modern rewrite of this project is underway!
It will be much more robust, fully modular and customizable, with hardware acceleration, and hopefully much more!

<img src=https://cdn.extragon.cloud/file/16f88ce81a1c169f.webp> <br>
<img src=https://cdn.extragon.cloud/file/21b130d594cef8dd.webp> <br>

You can map anything: <br>
<img src=https://cdn.extragon.cloud/file/babda96913e5a577.webp> <br>

<br>

## How to install (from source):
I will try to make this as simple as possible, as there aren't any pre-built releases yet.<br>
It should work on Linux, Windows and MacOS, but I have only tested it on Linux.

### First steps
To run this, you first need to, well, download all dependencies.<br>
You will need to have the following installed on your system:
- Install [Node.js](https://nodejs.org/en/download/current) (v26 or higher recommended, v22 or higher needed) if you don't have it already
- `npm` (comes with Node.js) or optionally `pnpm` (install with `npm install -g pnpm`)
- Optional but recommended: Electron (`npm install -g electron`)

Then:
- Clone this repo (either with `git clone` or download the zip and extract it (On GitHub, click "Code" -> "Download ZIP")), or with whatever's your favorite git client.
- Open a terminal in the directory where you cloned/extracted the files and run `npm i --omit=dev` (or `pnpm i` if you have pnpm) to install dependencies (this is done only once).

After that you should be ready to run the app, see below.

### With Electron (recommended)
Run `electron .` (or maybe try `npm run start` if you don't have it globally) in the project directory, and it should launch the app.

Done!

### Without Electron/web version (not recommended)
Technically the UI should now be able to run in a plain browser without further special setup or backend, so you can run `npx http-server` in the project directory and open the URL it gives you in a modern browser.<br><br>
However, this is **not** recommended as some features won't work properly (such as filesystem access, accelerated processing, audio DSP (or any other native audio processing engine), certain encoding features, proxy files, etc.). You will probably get a limited experience and as it's not the intended way to run the app as of now, it may not work at all in some cases.
<br>

### The proper way to install the app later
Soon I will provide pre-packaged releases for Linux and possibly Windows or MacOS, but I first need to decide how to split the engine from the flavors and how to package them which is a bit complex due to how the architecture is structured.<br><br>
If it fails to load or complains about missing LS, it's because I didn't add a copy of the library. You can switch it to a CDN version in the index.html file until I add it (swap out the commented lines).

Since this is a work in progress, there are no pre-built releases for now, but you can run it from source code as described above.
<br>

<br>

<details>
<summary>See old version (1.x)</summary>

### Old screenshots
This is how the software looked before the rewrite and migration to a whole new architecture.

![Screenshot from 2024-06-08 15-24-09](https://github.com/the-lstv/VideoEditor/assets/62482747/8ed7e3fe-a054-453d-804a-3be2f4465c77)
![Screenshot from 2024-06-11 02-12-21](https://github.com/the-lstv/VideoEditor/assets/62482747/7c68d73a-f1a8-4028-a13f-95f6eb063b97)
</details>

---

<img src=https://cdn.extragon.cloud/file/a771e02dfb37f618.svg> <br>
This software is made by a real human, not by AI. This project does not contain AI generated content or code.<br>
This project is fully programmed solely by Lukas @ lstv.space; including all UI libraries, components, etc. with only a very few external dependencies. Please consider supporting me if you find the software useful! Many, many hours of work have gone into this project.<br>
Licensed under the GPL-3.0 License.