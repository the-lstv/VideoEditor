/**
 * The connector API for the audio engine. This is a placeholder for now.
 * 
 * @copyright 2026 lstv.space
 * 
 * Nodes are like normal nodes, outputing audio data, midi data, or anything else.
 */

const __dirname = decodeURIComponent(
    new URL(".", import.meta.url).pathname
).replace(/^\/([A-Za-z]:)/, "$1");

class AudioNode {}
class InputSource extends AudioNode {}
class MIDITrackProcessor extends AudioNode {}

class Engine {
    static name = "AudioEngine";

    // There could later be a browser fallback
    static loadEngine() {
        if(Engine.audioEngine) return Engine.audioEngine;

        try {
            const isElectron = typeof process.versions.electron !== 'undefined';
            const fs = require('fs');

            let path;

            if(!isElectron) {
                path = __dirname + '/audio-engine/dist/' + process.platform + '_' + process.arch + '_' + process.versions.modules + '_node.node';
            } else {
                path = __dirname + '/audio-engine/dist/' + process.platform + '_' + process.arch + '_' + process.versions.modules + '_electron.node';
            }

            if(!fs.existsSync(path)) {
                // We could try to download the prebuilt binary here later
                throw new Error('AudioEngine supports only Node.js versions 20, 22, 24 and 26 on (glibc) Linux, macOS and Windows, on Tier 1 platforms (https://github.com/nodejs/node/blob/master/BUILDING.md#platform-list).\n\n' + e.toString());
            }

            Engine.audioEngine = require(path);
            return Engine.audioEngine;
        } catch (e) {
            throw new Error('AudioEngine: The native addon could not be loaded. Make sure you are using a supported Node.js version.\n\n' + e.toString());
        }
    }

    constructor(options = {}) {
        Engine.loadEngine();

        this.audioEngine = null;

        this.sampleRate = options.sampleRate || 44100;
        this.bufferSize = options.bufferSize || 512;
    }
};

export { Engine, AudioNode, InputSource, MIDITrackProcessor };