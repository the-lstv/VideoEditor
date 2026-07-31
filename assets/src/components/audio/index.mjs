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
            const { path, exists } = Engine.getEnginePath();
            if(!exists) {
                // We could try to download the prebuilt binary here later
                throw new Error('AudioEngine supports only Node.js versions 20, 22, 24 and 26 on (glibc) Linux, macOS and Windows, on Tier 1 platforms (https://github.com/nodejs/node/blob/master/BUILDING.md#platform-list).\n\n' + e.toString());
            }

            Engine.audioEngine = require(path);
            return Engine.audioEngine;
        } catch (e) {
            throw new Error('AudioEngine: The native addon could not be loaded. Make sure you are using a supported Node.js version.\n\n' + e.toString());
        }
    }

    static getEnginePath() {
        const isElectron = typeof process.versions.electron !== 'undefined';
        const fs = require('fs');

        let name;

        if(!isElectron) {
            name = process.platform + '_' + process.arch + '_' + process.versions.modules + '_node.node';
        } else {
            name = process.platform + '_' + process.arch + '_' + process.versions.modules + '_electron.node';
        }

        const exists = fs.existsSync(name);

        return { path: __dirname + '/audio-engine/dist/' + name, name, exists };
    }

    static async userInitializeEngine(skipConfirmation = false) {
        const { path, exists, name } = Engine.getEnginePath();

        if(!Engine.audioEngine && !exists) {
            const downloadAllowed = skipConfirmation || await LS.Modal.confirm('The audio engine needed for this application is not present. Do you want to download it for your system now?', {
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
                        xmlHTTP.open('GET', 'https://run.lstv.space/binaries/metadaw-audio-engine/' + name, true);
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
                                    content: 'Failed to download AudioEngine binary.<br>HTTP status: ' + xmlHTTP.status + '.<br><br>File needed: <b>' + name + '</b><br><br>Make sure that you are connected to the internet and that your system and environment is supported. A build needs to be available on <a href="https://run.lstv.space/binaries/metadaw-audio-engine/" target="_blank">https://run.lstv.space</a>.<br><br>If contacting support, please provide the above file name.',
                                    buttons: [
                                        { label: 'Retry', class: "elevated", onClick: (e) => { LS.Modal.closeFromElement(e.target); Engine.userInitializeEngine(true).then(() => { resolve(); }); } },
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

        return Engine.loadEngine();
    }

    constructor(options = {}) {
        Engine.loadEngine();

        this.audioEngine = null;

        this.sampleRate = options.sampleRate || 44100;
        this.bufferSize = options.bufferSize || 512;
    }
};

export { Engine, AudioNode, InputSource, MIDITrackProcessor };