![DAW logo](src/flavors/merge/images/_.svg)
![VideoEditor logo](src/flavors/video-editor/images/icon.svg)
![QuickSand logo](src/flavors/quicksand/images/icon.svg)

# LS Creative Suite

A full-featured, professional, fast and intuitive:
- Video & motion graphics editor for filmmakers, video editors, and motion graphics artists
- Digital audio workstation (DAW) for music production, and (eventually)
- A game engine for game developers.

Built on [LSv6](https://github.com/the-lstv/LS) and (momentarily) Electron, in the future LSv7 with Crystaline instead of Electron, written in C++ and JavaScript.

Features and capabilities (work in progress):
- Friendly to beginners but also powerful for professionals
- Automation & animation clips
- The whole interface is hackable/programmable and modular
- Everything is patch-able
- Intuitive controls that can make your workflow super smooth
- Easy to use, modern, simple to learn but powerful UI
- Highly customizable
- 3D and VR support*, hardware acceleration & custom shader effects and pipelines
- Quick access command palette for instant access
- Multi-timeline support
- Optimized & very lightweight
- Support for a wide variety of formats and codecs
- Subtitle editing, keying, rotoscoping, etc.*
- Advanced audio editing and signal processing features, MIDI support, VST plugin support, and more!*
- Much more!

\* = planned features that are not yet fully implemented.

## A full modern rewrite of this project is underway!
It will be much more robust, fully modular and customizable, with hardware acceleration, and hopefully much more!

<img src=https://cdn.extragon.cloud/file/16f88ce81a1c169f.webp> <br>
<img src=https://cdn.extragon.cloud/file/21b130d594cef8dd.webp> <br>

You can map anything: <br>
<img src=https://cdn.extragon.cloud/file/babda96913e5a577.webp> <br>

<br>

## How to install:

#### I will try to make this very simple to follow even if you are a beginner/not a tech person!

There aren't any pre-built releases yet (please understand that there can't be as the project is in development and not sufficiently tested to be distributed in final binaries, for various reasons.<br>
Eventually the project will be easily downloadable from lstv.space or from releases).<br><br>

It should work on **Linux**, **Windows** and **MacOS**, but I have only tested it on Linux. Linux is the primary platform and should work the best. Windows support is experimental, MacOS is untested as of now.

### First step
To run this program, first make sure you have Node.js installed.<br>
- Install [Node.js from this website](https://nodejs.org/en/download/current) (Version 26 or higher is recommended), if you don't have it already.

### Second step
- Clone this repo to download the program (If you have a git client simply use that or `git clone`, otherwise you can download the zip and extract it **(On GitHub, click "Code" -> "Download ZIP"), note that without a git client you will need to manually download updates.)**
- Then open the folder where you cloned/extracted the files and open a terminal/command prompt (on Windows 11, right-click in the folder and select **"Open in Windows Terminal"**, on Linux either use a similar option or simply press `Ctrl + Alt + T`)
- Then paste this command:
```bash
npm i --omit=dev
```
(or `pnpm i` if you have pnpm) to install dependencies (this is done only once to install packages).

After that you should be ready to run the app, continue to the next section.

### Run the app
Run `npm run start`, and it should launch the app.<br>
The app should take care of the rest of the setup if there's anything else needed so you should be set. If any further action is needed, the app will tell you.<br>

**Done! ⭐**

---

### Running without Electron / on the web (not recommended)

Some parts or functionality can work in a web browser without further special setup or backend, so could simply run `npx http-server` in the project directory and open the URL it gives you in a modern browser.<br><br>
However, this is **not** recommended and some features won't work, such as file access, accelerated rendering, advanced audio processing, and certain encoding features, proxy files, etc.<br>
You will probably get a limited experience and as it's not the intended way to run the app as of now, it may not work at all in some cases.
<br>

### The proper way to install the app later
Soon I will provide pre-packaged releases for Linux, Windows or MacOS.<br>
But I will first need to decide how to split the engine from the flavors and how to package them which is a bit complex due to how the program is currently structured as I don't want to make it too monolithic.<br><br>

If it fails to load or complains about missing LS on startup, it's because I didn't add a copy of the library. You can switch it to a CDN version in the index.html file until I add it (swap out the commented lines).

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
This software is made by a human, not by AI. This project does not contain AI generated content or code.<br>
This project is fully programmed solely by Lukas; including all UI libraries, components, etc. with only a very few external dependencies.<br>
Please consider supporting me if you find the software useful! Many, many hundreds of hours of work have gone into this project.<br>

Note: The project is no longer "open source" since 2.3.0-alpha and up, because of current issues with FOSS license bypassing.<br>
This decision hurts to make as I always stood for free software, but I cannot allow my work to be plainly stolen or used for AI training with no compensation, I hope you understand.<br>
I will still provide support and accept contributions.<br>

If you have anything against this decision, please leave and do not use this software. Use AI editing tools instead or make your own, this project is simply not for you.<br><br>
(But if you just need help with anything or run into any issues, feel free to reach out and I will provide support! I don't bite! You can contact me on Discord: thelstv)