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

const module = {};

// There could later be a browser fallback
function loadEngine() {
    if(module.Engine) return module.Engine;

    try {
        const { path, exists } = getEnginePath();
        if(!exists) {
            // We could try to download the prebuilt binary here later
            throw new Error('AudioEngine supports only Node.js versions 20, 22, 24 and 26 or Electron 43.2.0 on (glibc) Linux, macOS and Windows, on Tier 1 platforms (https://github.com/nodejs/node/blob/master/BUILDING.md#platform-list).');
        }

        // I know ts ass but ESM is ESM
        Object.assign(module, require(path));
        class Engine extends module.EngineRuntime {
            static name = "AudioEngine";

            constructor(options = {}) {
                super(options.sampleRate || 44100, options.bufferSize || 512, options.scratchBufferCount || 64);

                this.sampleRate = options.sampleRate || 44100;
                this.bufferSize = options.bufferSize || 512;
                this.scratchBufferCount = options.scratchBufferCount || 64;

                this.createSharedMemory();
            }
            
            // ! Warning: the shared memory is read-only (and not thread safe). Writing to it will cause undefined behavior.
            // ! It is only for random reads of certain ocassional non-critical realtime report data from the audio engine, such as metrics or FFT/visualization data
            // ! Data in the shared memory is not guaranteed to be valid at any given time, and should only be used for informational purposes.
            createSharedMemory() {
                this.sharedBufferSize = this.getSharedBufferSize();
                this.sharedBuffer = new ArrayBuffer(this.sharedBufferSize);

                if (!this.attachBuffer(this.sharedBuffer)) {
                    throw new Error("Failed to attach shared buffer for the audio engine");
                }

                this.byteView = new Uint8Array(this.sharedBuffer);
                this.floatView = new Float32Array(this.sharedBuffer);
            }

            setNodeFlags(node, time, toMaster, invert, swap, bypass, mute) {
                if(!node) {
                    console.warn("Invalid node provided to setFlags:", node);
                    return;
                }

                node.invert = invert ?? node.invert;
                node.swap = swap ?? node.swap;
                node.bypass = bypass ?? node.bypass;
                node.mute = mute ?? node.mute;

                const nodeId = node.__programOffset;
                if(typeof nodeId === "number") {
                    let flags = 0;
                    flags |= node.invert ? 1 << 0: 0;
                    flags |= node.swap   ? 1 << 1: 0;
                    flags |= node.bypass ? 1 << 2: 0;
                    flags |= node.mute   ? 1 << 3: 0;
                    this.setFlags(time, node, flags);
                }
            }

            setNodeUniform(node, time, uniformIndex, value) {
                if(!node) {
                    console.warn("Invalid node provided to setFlags:", node);
                    return;
                }

                node.uniforms ??= new Float32Array(15);
                node.uniforms[uniformIndex] = value;

                const nodeId = node.__programOffset;
                if(typeof nodeId === "number") this.setUniform(time, node, uniformIndex, node.uniforms[uniformIndex]);
            }
        };

        module.Engine = Engine;
        return module;
    } catch (e) {
        throw new Error('AudioEngine: The native addon could not be loaded. Make sure you are using a supported Node.js version.\n\n' + e.toString());
    }
}

function getEnginePath() {
    const isElectron = typeof process.versions.electron !== 'undefined';
    const fs = require('fs');

    let name;

    if(!isElectron) {
        name = process.platform + '_' + process.arch + '_' + process.versions.modules + '_node.node';
    } else {
        name = process.platform + '_' + process.arch + '_' + process.versions.modules + '_electron.node';
    }

    const path = __dirname + 'audio-engine/dist/' + name;
    const exists = fs.existsSync(path);

    return { path, name, exists };
}

async function userInitializeEngine(skipConfirmation = false) {
    const { path, exists, name } = getEnginePath();

    // The only official source
    const SOURCE = "https://repo.lstv.space/";

    if(!module.Engine && !exists) {
        const downloadAllowed = skipConfirmation || await LS.Modal.confirm('The audio engine needed for this application is not present. Do you want to download it for your system now?<br><br>Debug info:<br><code>' + name + path + '</code>', {
            title: 'Download AudioEngine?'
        });

        if(downloadAllowed) {
            const progress = new LS.Range(LS.Range.PRESET_PROGRESS);

            const modal = LS.Modal.buildEphemeral({
                title: "Downloading engine binary...",
                content: [
                    progress.element
                ]
            }, {
                closeable: false
            });

            await new Promise(resolve => {
                try {
                    const xmlHTTP = new XMLHttpRequest();
                    xmlHTTP.open('GET', SOURCE + 'binaries/metadaw-audio-engine/' + name, true);
                    xmlHTTP.responseType = 'arraybuffer';

                    xmlHTTP.onprogress = (event) => {
                        if(event.lengthComputable) {
                            progress.value = event.loaded / event.total;
                        }
                    }

                    xmlHTTP.onload = () => {
                        modal.close();

                        if(xmlHTTP.status === 200) {
                            const arrayBuffer = xmlHTTP.response;
                            const fs = require('fs');

                            try {
                                fs.writeFileSync(path, Buffer.from(arrayBuffer));
                                resolve();
                            } catch (e) {
                                LS.Modal.alert('Failed to save AudioEngine binary:', e);
                            }
                        } else {
                            LS.Modal.buildEphemeral({
                                title: 'Download failed',
                                content: 'Failed to download AudioEngine binary.<br>HTTP status: ' + xmlHTTP.status + '.<br><br>File needed: <b>' + name + '</b><br><br>Make sure that you are connected to the internet and that your system and environment is supported. A build needs to be available on <a href="' + SOURCE + '" target="_blank">' + SOURCE + '</a>.<br><br>If contacting support, please provide the above file name.',
                                buttons: [
                                    { label: 'Retry', class: "elevated", onClick: (e) => { LS.Modal.closeFromElement(e.target); userInitializeEngine(true).then(() => { resolve(); }); } },
                                    { label: 'OK', onClick: (e) => { LS.Modal.closeFromElement(e.target); resolve(); } }
                                ]
                            });
                        }
                    }

                    xmlHTTP.send();
                } catch (e) {
                    LS.Modal.alert('Error downloading AudioEngine binary:', e);
                    resolve();
                }
            });
        }
    }

    return loadEngine();
}

// Order matters
const processors = [
    "MixerTrack",
    "Oscillator",
    "VST3Processor",
    "Reverb",
    "Delay",
    "Chorus",
    "Dattorro",
    "Bitcrusher",
    "Waveshaper",
    "Massive",
    "Chroma",
    "Sampler",
    "WaveTable",
    "Sequencer",
    "Tidal",
    "LFO",
    "Envelope",
    "AudioInput",
    "Filter",
    "Limiter",
    "Compressor",
    "TransientProcessor",
    "Stereo",
    "Widen",
    "VST2Processor",
    "CLAPProcessor",
    "AAXProcessor",
    "CustomProcessor",
]

export { module, loadEngine, getEnginePath, userInitializeEngine, processors };