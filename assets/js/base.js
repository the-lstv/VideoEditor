const isNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null;

if(isNode) {
    require(__dirname + "/assets/js/electron-api.js");
}

/**
 * Project class
 * Currently the main class connecting views and rendering together
 */
class Project extends LS.EventHandler {
    constructor(data) {
        super();

        this.connectedViews = new Map();
        this.currentTimeline = null;

        this.timeline = null;
        this.resources = new ResourceManager(this);
        this.historyManager = new HistoryManager(this);

        this.patcher = new LS.Patcher(this);

        this.config = {};
        this.initialized = false;

        this.frameScheduler = new LS.Util.FrameScheduler((delta) => {
            if(delta > 0 && this.timeline) {
                this.timeline.setSeek(this.timeline.seek + (delta / 1000));
            }

            this.renderAtTime(this.timeline.seek || 0);
        }, {
            deltaTime: true
        });

        this.editingItem = null;


        this.frameScheduler.limitFPS(60); // Limit FPS in the editor (exports can have any framerate)
        this.init(data);

        // Cache event references that are emitted frequently (small benefit but skips event lookup)
        this.__seekEventRef = this.prepareEvent('seek');
    }

    get playing() {
        return this.frameScheduler.running;
    }

    set playing(value) {
        value = !!value;
        if(this.frameScheduler.running === value) return;

        this.emit('playing-changed', [value]);
        this.emit(value? 'play': 'pause');

        if(value) {
            this.frameScheduler.start();
        } else {
            this.frameScheduler.stop();
        }
    }

    get duration() {
        return this.timeline? this.timeline.duration: 0;
    }

    togglePlay() {
        this.playing = !this.playing;
    }

    play() {
        this.playing = true;
    }

    pause() {
        this.playing = false;
    }

    seek(time, moveCamera = false) {
        if(this.timeline) {
            this.timeline.setSeek(time);
            if(moveCamera) {
                this.timeline.offset = time * this.timeline.zoom;
            }
        }
    }

    get time() {
        return this.timeline? this.timeline.seek: 0;
    }

    /**
     * THE MAIN VIDEO FRAME RENDERING LOGIC, must be kept well optimized
     * In the future calling WebGL directly (without PIXI) could be better, the node based rendering isn't great for videos
     * @param {Number} time Time in seconds
     */
    renderAtTime(time) {
        if(!this.timeline || !this.loaded) return;
        if(time === undefined) time = this.timeline.seek;

        // Clear screen
        this.renderer.renderer.clear();

        const renderTargets = [];

        // First loop to process automation items and values
        // We find intersecting items at the current time via a binary search
        const items = this.timeline.getIntersectingAt(time);

        if(this.editingItem) {
            items.push(this.editingItem);
        }

        for(const item of items) {
            if(item.type === "automation") {
                // Process automation items
                this.processAutomationItemAtTime(item, time);
                continue;
            }

            if(item.data?.enabled === false || item.data?.visible === false) continue;
            if(!item.node) this.createItemNode(item);
            if(!item.node) continue;

            if(item.resourceUpdated) {
                this.updateNodeResource(item);
            }

            if(item.data.animations) {
                for(const anim of item.data.animations) {
                    if(anim.enabled === false) continue;
                    this.processAutomationItemAtTime(anim, time);
                }
            }

            renderTargets.push(item);
        }

        // TODO: Optimize
        renderTargets.sort((a, b) => (a.data.zIndex || a.row || 0) - (b.data.zIndex || b.row || 0));

        // Render all items to the main renderer
        for(const item of renderTargets) {
            this.renderer.renderer.render({
                container: item.node,
                clear: false,
            });
        }
    }

    processAutomationItemAtTime(item, time) {
        if(!item.__automationClip || !item.data || !item.data.targets || item.data.enabled === false || item.data.targets.length === 0) return;

        if (item.data.automationFunction && (item.__dirtyMapping || !item.mappingFn)) {
            try {
                item.mappingFn = Project.compileMappingFunction(item.data.automationFunction);
            } catch (e) {
                console.error("Failed to compile automation mapping function:", e);
                item.mappingFn = Project.NOOP_FUNCTION;
            }

            item.__dirtyMapping = false;
        } else if(!item.data.automationFunction) {
            item.mappingFn = Project.NOOP_FUNCTION;
        }

        const automationValue = item.mappingFn(item.__automationClip.getValueAtTime(time - item.start), time);

        // Use cached targets
        if(item.__cTargets && !item.__dirty) {
            for (const cTarget of item.__cTargets) {
                const baseValue = cTarget.isRelative? cTarget.target.data[cTarget.property] || 0: 0;
                cTarget.setter(cTarget.target, baseValue + cTarget.mappingFn(automationValue, time));
            }
            return;
        }

        // Compile targets
        const compiled = [];
        for (let i = 0; i < item.data.targets.length; i++) {
            const target = item.data.targets[i];

            const targetNode = target.nodeId? this.timeline.getItemById(target.nodeId): null;
            if(!targetNode) continue;
            if(!targetNode.node) this.createItemNode(targetNode);
            if(!targetNode.node) continue;

            const setter = Project.nodePropertySetters[target.property];
            if(typeof setter !== "function") continue;
            
            const mappingFn = target.__mappingCache || (target.mapping && target.mapping !== "x"? Project.compileMappingFunction(target.mapping): Project.NOOP_FUNCTION);
            target.__mappingCache = mappingFn;

            const isRelative = target.isRelative;
            const finalValue = isRelative? (targetNode.data[target.property] || 0) + (mappingFn(automationValue, time)): mappingFn(automationValue, time);

            setter(targetNode, finalValue);

            compiled.push({
                setter,
                target: targetNode,
                property: target.property,
                mappingFn,
                isRelative
            });
        }

        item.__cTargets = compiled;
        item.__dirty = false;
    }

    render() {
        this.frameScheduler.schedule();
    }

    setTimeline(timelineId) {
        const timeline = Array.isArray(timelineId)? timelineId: this.timelines.get(timelineId);
        this.currentTimeline = timeline;
        if(this.timeline) {
            this.timeline.reset(true, timeline);
        }
    }

    connect(view) {
        if(view.parent) {
            view.parent?.disconnect(view);
        }

        view.parent = this;

        switch(view.constructor) {
            case EditorViews.TimelineView:
                this.timeline = view.timeline;
                this.connectedViews.set('timeline', view);
                this.setTimeline(this.currentTimeline || "main");

                this.timeline.on('seek', () => {
                    this.frameScheduler.schedule();
                    this.emit(this.__seekEventRef, [view.timeline.seek]);
                });

                this.timeline.on('duration-changed', (duration) => {
                    this.emit('duration-changed', [duration]);
                });

                this.timeline.on('item-select', (item) => {
                    const itemEditor = this.connectedViews.get('propertyEditor');
                    if(itemEditor) {
                        itemEditor.setTarget(item);
                        this.editingItem = item;
                        this.render();
                    }
                });

                this.timeline.on('item-deselect', () => {
                    const itemEditor = this.connectedViews.get('propertyEditor');
                    if(itemEditor) {
                        itemEditor.setTarget(null);
                    }
                    this.editingItem = null;
                    this.render();
                });

                this.timeline.on("drag-start", (type) => {
                    if(type === "seek") {
                        this.prevPlayState = this.playing;
                        this.pause();
                    }
                });

                this.timeline.on("drag-end", (type) => {
                    if(type === "seek" && this.prevPlayState) {
                        this.play();
                    }
                });

                this.timeline.on('file-dropped', async (files, row, offset) => {
                    this.resources.addProjectResources(files, row, offset);
                });

                this.timeline.on('action', (action) => {
                    this.historyManager.execute(action);
                });

                this.timeline.on("item-cleanup", (item) => {
                    if(item.node) {
                        item.node.destroy({ children: true });
                        item.node = null;
                    }
                });

                this.emit(this.__seekEventRef, [this.timeline.seek]);
                this.emit('duration-changed', [this.timeline.duration]);
                break;

            case EditorViews.PreviewView:
                this.connectedViews.set('preview', view);
                view.setSource(this.renderer);
                break;

            case EditorViews.PropertyEditorView:
                this.connectedViews.set('propertyEditor', view);
                break;
            
            case EditorViews.AssetManagerView:
                this.connectedViews.set('assetManager', view);
                break;

            default:
                console.warn(`Project.connect: Unsupported view type ${view.constructor.name}`);
        }

        if(view.onAttached) view.onAttached(this);

        view.once("destroy", view.__parentDestroyHandler = () => {
            this.disconnect(view);
        });

        return this;
    }

    disconnect(view) {
        if(typeof view === "string") {
            view = this.connectedViews.get(view);
        }

        view.off("destroy", view.__parentDestroyHandler);
        delete view.__parentDestroyHandler;

        switch(view.constructor) {
            case EditorViews.TimelineView:
                view.timeline.reset(true);
                this.timeline.events.clear();
                this.timeline = null;
                this.connectedViews.delete('timeline');
                break;

            case EditorViews.PreviewView:
                view.setSource(null);
                this.connectedViews.delete('preview');
                break;

            case EditorViews.PropertyEditorView:
                this.editingItem = null;
                view.setTarget(null);
                this.connectedViews.delete('propertyEditor');
                break;

            case EditorViews.AssetManagerView:
                this.connectedViews.delete('assetManager');
                break;

            default:
                console.warn(`Project.disconnect: Unsupported view type ${view.constructor.name}`);
        }

        if(view.onDetached) view.onDetached(this);

        view.parent = null;
        this.loaded = false;
    }

    async init(data) {
        if(this.initialized) return;
        await this.loadFrom(data || {});

        this.renderingCanvas = document.createElement('canvas');
        this.renderer = new LS.GL.Renderer({
            canvas: this.renderingCanvas,
            width: 1280,
            height: 720,
            backgroundColor: 0x000000,
            ticker: false,
            tooltips: false,
            handleInputEvents: false,
            ...(this.config.rendererOptions || {})
        });

        await this.renderer.init();
        this.initialized = true;

        window.__PIXI_DEVTOOLS__ = {
            renderer: this.renderer.renderer
        };

        this.completed('ready');
    }

    async loadFrom(data = {}) {
        this.loaded = false;
        let resourcesLoaded = false;

        // Handle zip file
        if (data instanceof Blob || data instanceof ArrayBuffer) {
            try {
                const buffer = data instanceof Blob? await data.arrayBuffer(): data;
                const unzipped = await new Promise((resolve, reject) => {
                    fflate.unzip(new Uint8Array(buffer), (err, files) => {
                        if (err) reject(err);
                        else resolve(files);
                    });
                });

                if (unzipped['project.json']) {
                    const projectJson = new TextDecoder().decode(unzipped['project.json']);
                    data = JSON.parse(projectJson);

                    await this.resources.loadFrom(data.resources || {});
                    resourcesLoaded = true;

                    // TODO: Load resource data from zip
                    const assetFolder = 'assets/';
                    for (const [filename, fileData] of Object.entries(unzipped)) {
                        if (filename.startsWith(assetFolder)) {
                            const hash = filename.substring(assetFolder.length);

                            // Load file data into resource manager
                            const file = this.resources.resources.get(hash);
                            if (file) {
                                file.data = fileData;
                            }
                        }
                    }
                } else {
                    throw new Error('project.json not found in zip');
                }
            } catch (err) {
                console.error('Failed to load zip file:', err);
                return;
            }
        }

        if (typeof data === "string") {
            data = JSON.parse(data);
        }

        this.config = data.config || {};
        if(!this.config.rendererOptions) {
            this.config.rendererOptions = {
                width: 1280,
                height: 720
            };
        }

        this.timelines = new Map(Object.entries(data.timelines || {
            "main": []
        }));

        if(!resourcesLoaded) await this.resources.loadFrom(data.resources || {});
        this.setTimeline(this.config.timeline || "main");
        this.loaded = true;
    }

    createItemNode(item) {
        if(!item || item.node) return null;
        if(!item.data) item.data = {};

        if(item.type === "automation") {
            return null;
        }

        switch(item.type) {
            case "container":
                item.node = new PIXI.Container();
                break;

            case "graphics":
                item.node = new PIXI.Graphics();
                break;

            case "sprite":
            case "image":
            case "video": // Yes it's just a sprite (video frames get updated on the texture)
                item.node = new PIXI.Sprite(PIXI.Texture.WHITE);
                if(item.type === "image") item.type = "sprite"; // Normalize
                break;

            case "text":
                item.node = new PIXI.Text(item.data.text || "", item.data.style || {});
                break;

            case "sound":
            case "notes":
                // No visual node, but (TODO:) should create an audio node
                return null;

            // Currently unsupported
            // case "mesh":
            //     break;

            default:
                console.warn(`Project.createItemNode: Unsupported item type ${item.type}`);
                return null;
        }

        this.applyInitialNodeProperties(item);
        return item.node;
    }

    async applyInitialNodeProperties(item) {
        if(!item) return;
        if(!item.data) item.data = {};

        // Apply all saved properties
        for(const property in item.data) {
            Project.nodePropertySetters[property]?.(item, item.data[property]);
        }

        await this.updateNodeResource(item);
    }

    async updateNodeResource(item) {
        if(!item.data.resource || item.resourceUpdated === false) return;
        item.resourceUpdated = false;

        const resource = await this.resources.getAssetObject(item.data.resource);
        console.log("got resource for item", item, resource);

        if(resource) {
            if(resource instanceof PIXI.Texture && item.node instanceof PIXI.Container) {
                item.node.texture = resource;
            }

            // TODO: Handle other resource types
        }
    }

    applyNodeProperty(item, property, value) {
        if(!item) return;

        const applier = Project.nodePropertySetters[property];
        if(applier) {
            applier(item, value);

            if(property !== "tileColor" && property !== "clipDuration" && property !== "clipStartTime") {
                item.data[property] = value;
            }
        } else {
            console.warn(`Project.applyNodeProperty: Unsupported property ${property}`);
        }
    }

    getNodeProperty(item, property) {
        if(!item) return null;

        const getter = Project.nodePropertyGetters[property];
        if(getter) {
            return getter(item);
        } else {
            console.warn(`Project.getNodeProperty: Unsupported property ${property}`);
            return null;
        }
    }

    getSavedNodeProperty(item, property, fallback = true) {
        if(!item || !item.data) return null;
        return item.data[property] || (fallback ? this.getNodeProperty(item, property) : null); // Fallback to reading from node
    }

    export(asString = false) {
        const exportedTimelines = {};
        for(const [id, timeline] of this.timelines) {
            exportedTimelines[id] = timeline.map(item => {
                return this.timeline.cloneItem(item, true);
            });
        }

        const data = {
            config: this.config,
            timelines: exportedTimelines,
            resources: this.resources.export(),
        };

        return asString? JSON.stringify(data): data;
    }

    /**
     * Packages the project as a zip file.
     * This is mainly useful for small projects only in the browser where native file access or directory access is not possible.
     * Don't use this for large projects
     * @param {*} download 
     * @warning This should not be used most of the time
     * @returns {fflate.Zip} The zip object
     */
    exportZip(download = false, callback = null) {
        const chunks = [];
        const zip = new fflate.Zip((err, data, final) => {
            if (err) {
                console.error("Error generating zip:", err);
                if(callback) callback(err);
                return;
            }

            if (data) chunks.push(data);

            if (final && download) {
                const blob = new Blob(chunks, { type: 'application/zip' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = (this.config.name || 'project') + '.zip';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                chunks.length = 0;

                if(callback) callback();
            }

        });

        const project = new fflate.ZipDeflate("project.json", {
            level: 9
        });

        zip.add(project);
        project.push(new TextEncoder().encode(this.export(true)), true);

        for (const resource of this.resources.getBundledResources()) {
            // Zip will only include resources explicitly set in the project folder, others are external
            if(resource.sourceType !== 'project_folder') continue;

            const file = new fflate.ZipDeflate("assets/" + resource.hash, {
                level: 9
            });

            zip.add(file);
            file.push(resource.data, true);
        }
        zip.end();
        return zip;
    }

    /**
     * Destroys the project and optionally all connected views
     * @param {Boolean} destroyViews Whether to destroy connected views
     */
    destroy(destroyViews = false) {
        if(this.__destroyed) return;

        // TODO: Proper destruction
        // Warning; destroyViews will destroy anything connected to the project, so possibly everything

        for(const view of this.connectedViews.values()) {
            this.disconnect(view);
            if(destroyViews) {
                view.destroy();
            }
        }

        if(this.timeline) {
            // If destroyViews is true, the timeline has been destroyed already, so we don't need to reset it
            if(!destroyViews) this.timeline.reset(true);
            this.timeline = null;
        }

        this.renderer.destroy();
        this.connectedViews.clear();
        this.currentTimeline = null;
        this.timelines.clear();
        this.renderingCanvas.remove();
        this.frameScheduler.destroy();
        this.frameScheduler = null;
        this.resources.destroy();
        this.resources = null;
        this.historyManager.destroy();
        this.emit('destroy');
        this.events.clear();
        this.config = null;
        this.__destroyed = true;
    }

    /**
     * Replaces this project with another one
     * @param {*} otherProject 
     * @returns 
     */
    replaceWith(otherProject) {
        if(!(otherProject instanceof Project)) {
            console.error("Project.replaceWith: otherProject must be an instance of Project");
            return;
        }

        // TODO: Replace only views that support it; otherwise destroy and recreate
        for(const view of this.connectedViews.values()) {
            this.disconnect(view);
            otherProject.connect(view);
        }
        this.destroy();
    }

    static openFromZipFile(callback) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip,application/zip';
        input.onchange = async () => {
            if (input.files.length > 0) {
                const file = input.files[0];
                const project = new Project(file);
                if(callback) callback(project);
                return project;
            }
        };
        input.click();
    }

    static NOOP_FUNCTION = (x) => x;

    static functionMap = {
        'sin': 'Math.sin', 'cos': 'Math.cos', 'tg': 'Math.tan', 'tan': 'Math.tan',
        'ctg': '(1/Math.tan', 'sec': '(1/Math.cos', 'cosec': '(1/Math.sin',
        'arcsin': 'Math.asin', 'arccos': 'Math.acos', 'arctg': 'Math.atan', 'arctan': 'Math.atan',
        'exp': 'Math.exp', 'sqrt': 'Math.sqrt', 'ln': 'Math.log', 'log10': 'Math.log10', 'log2': 'Math.log2',
        'neg': '(-', 'abs': 'Math.abs', 'pi': 'Math.PI',
        'sum': '(', 'min': 'Math.min', 'max': 'Math.max',
        'round': 'Math.round', 'int': 'Math.floor', 'frac': '((v)=>v-Math.floor(v))',
        'ife': '((a,b)=>a===b?1:0)', 'ifl': '((a,b)=>a<b?1:0)', 'ifg': '((a,b)=>a>b?1:0)',
        'ifle': '((a,b)=>a<=b?1:0)', 'ifge': '((a,b)=>a>=b?1:0)',
        'case': '((a,b,c)=>a===1?b:c)', 'x': 'x', 'input': 'x', 'e': 'Math.E', 'rand': 'Math.random()',
        'clamp': '((v,min,max)=>Math.min(Math.max(v,min),max))',
        'lerp': '((a,b,t)=>a+(b-a)*t)',
        'smoothstep': '((edge0,edge1,x)=>{let t=Math.min(Math.max((x - edge0)/(edge1 - edge0),0),1);return t*t*(3 - 2*t);})',
        'y': 'y', 'time': 'y'
    };

    /**
     * Compiles a mapping function from a string code
     * @param {*} code The string code to compile
     * @returns The compiled function
     * 
     * @example
     * const func = Project.compileMappingFunction("sin(x) + 2 * x^2");
     * const result = func(1.5); // Evaluate the function at x = 1.5
     */
    static compileMappingFunction(code) {
        code = code.trim().toLowerCase();

        if(!code || code.length === 0) {
            return Project.NOOP_FUNCTION;
        }

        let i = -1, cs = null, state = 0, operations = [];
        while(i++ < code.length -1) {
            const char = code.charCodeAt(i);
            const isLast = i === code.length -1;

            if(state === 1) {
                const isDigit = (char >= 48 && char <= 57) || char === 46;

                if(!isLast && isDigit) { // number
                    continue;
                }

                const includeCurrent = isLast && isDigit;
                const number = parseFloat(code.substring(cs, includeCurrent? i + 1: i));
                operations.push(number);

                state = 0;

                if(includeCurrent) {
                    break;
                }
            }

            if(char === 32 || char === 10 || char === 13 || char === 9) { // whitespace
                continue;
            }

            if(char === 43 || char === 45 || char === 42 || char === 47 || char === 37) { // +, -, *, /, %
                if(isLast) {
                    throw new Error(`Invalid end of mapping function: ${code[i]}`);
                }

                operations.push(String.fromCharCode(char));
                continue;
            }

            if(char === 94) { // ^
                operations.push('**');
                continue;
            }

            if(char === 33) { // !
                operations.push('!');
                continue;
            }

            // Handle mathematical functions
            if(char >= 65 && char <= 90 || char >= 97 && char <= 122) { // letter
                // Find end of function name
                let funcEnd = i;
                while(funcEnd < code.length && ((code.charCodeAt(funcEnd) >= 65 && code.charCodeAt(funcEnd) <= 90) || 
                      (code.charCodeAt(funcEnd) >= 97 && code.charCodeAt(funcEnd) <= 122))) {
                    funcEnd++;
                }

                const funcName = code.substring(i, funcEnd);
                const func = Project.functionMap[funcName];

                if(func) {
                    if(func === 'x' && operations.length === 0 && funcEnd === code.length) {
                        return Project.NOOP_FUNCTION;
                    }

                    operations.push(func);
                    i = funcEnd - 1;

                    // Add closing parenthesis for functions that need it
                    if(['ctg', 'sec', 'cosec', 'neg'].includes(funcName)) {
                        // Find matching closing parenthesis and add extra one
                        let depth = 0, j = funcEnd;
                        while(j < code.length) {
                            if(code.charCodeAt(j) === 40) depth++;
                            if(code.charCodeAt(j) === 41) {
                                depth--;
                                if(depth === 0) {
                                    // Insert extra closing paren after this position
                                    code = code.substring(0, j + 1) + ')' + code.substring(j + 1);
                                    break;
                                }
                            }
                            j++;
                        }
                    }

                    // Handle Sum specially - convert to addition
                    if(funcName === 'sum') {
                        // Find the comma and replace with +
                        let depth = 0, j = funcEnd;
                        while(j < code.length) {
                            if(code.charCodeAt(j) === 40) depth++;
                            if(code.charCodeAt(j) === 41) {
                                depth--;
                                if(depth === 0) break;
                            }
                            if(code.charCodeAt(j) === 44 && depth === 1) {
                                code = code.substring(0, j) + '+' + code.substring(j + 1);
                            }
                            j++;
                        }
                    }

                    continue;
                }
                
                throw new Error(`Unknown function in mapping: ${funcName}`);
            }

            if(char === 40 || char === 41 || char === 44) { // parentheses ( ) and comma
                operations.push(String.fromCharCode(char));
                continue;
            }

            if(char >= 48 && char <= 57) { // number
                if(isLast) {
                    const number = parseFloat(code.substring(i, i + 1));
                    operations.push(number);
                    break;
                }

                state = 1;
                cs = i;
                continue;
            }

            throw new Error(`Invalid character in mapping function: ${code[i]} (code ${char})`);
        }

        const generatedCode = "return (" + (operations.join('') || "0") + ") || 0;";
        return new Function('x', 'y', generatedCode);
    }

    static ensureTextStyle(item) {
        if(!(item.node instanceof PIXI.Text)) return;

        if(!item.data) {
            item.data = {};
        }

        if(!item.data.style) {
            item.data.style = {};
        }

        if(!(item.node.style instanceof PIXI.TextStyle)) {
            item.node.style = new PIXI.TextStyle(item.data.style);
        }
    }

    static nodePropertySetters = {
        "tileColor": (item, v) => {
            item.color = v;
        },

        "clipDuration": (item, v) => {
            item.duration = v;
        },

        "clipStartTime": (item, v) => {
            item.start = v;
        },

        "positionX": (item, v) => {
            if (item.node) item.node.position.x = v;
        },

        "positionY": (item, v) => {
            if (item.node) item.node.position.y = v;
        },

        "scaleX": (item, v) => {
            if (item.node) item.node.scale.x = v;
        },

        "scaleY": (item, v) => {
            if (item.node) item.node.scale.y = v;
        },

        "rotation": (item, v) => {
            if (item.node) item.node.rotation = v;
        },

        "anchorX": (item, v) => {
            if (item.node?.anchor) item.node.anchor.x = v;
        },

        "anchorY": (item, v) => {
            if (item.node?.anchor) item.node.anchor.y = v;
        },

        "skewX": (item, v) => {
            if (item.node) item.node.skew.x = v;
        },

        "skewY": (item, v) => {
            if (item.node) item.node.skew.y = v;
        },

        "visible": (item, v) => {
            v = !!v;
            if (item.node) item.node.visible = v;
        },

        "tint": (item, v) => {
            if (item.node) item.node.tint = v;
        },

        "opacity": (item, v) => {
            if (item.node) item.node.alpha = v;
        },

        "alpha": (item, v) => {
            if (item.node) item.node.alpha = v;
        },

        "blendMode": (item, v) => {
            if (item.node) item.node.blendMode = v;
        },

        "textContent": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                item.node.text = v;
            }
        },

        "textStyle": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                item.node.style = new PIXI.TextStyle(v);
            }
        },

        "textStyleWeight": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                Project.ensureTextStyle(item);
                item.node.style.fontWeight = v;
            }
        },

        "textStyleStyle": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                Project.ensureTextStyle(item);
                item.node.style.fontStyle = v;
            }
        },

        "textStyleFontSize": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                Project.ensureTextStyle(item);
                item.node.style.fontSize = v;
            }
        },

        "textStyleFontFamily": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                Project.ensureTextStyle(item);
                item.node.style.fontFamily = v;
            }
        },

        "textStyleFill": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                Project.ensureTextStyle(item);
                item.node.style.fill = v;
            }
        },

        "textStyleAlignment": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                Project.ensureTextStyle(item);
                item.node.style.align = v;
            }
        },

        "textStyleLineHeight": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                Project.ensureTextStyle(item);
                item.node.style.lineHeight = v;
            }
        },

        "textStyleWrapWidth": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                Project.ensureTextStyle(item);
                item.node.style.wordWrapWidth = v;
            }
        },

        "textStyleWrap": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                Project.ensureTextStyle(item);
                item.node.style.wordWrap = !!v;
            }
        },

        "textStyleLetterSpacing": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                Project.ensureTextStyle(item);
                item.node.style.letterSpacing = v;
            }
        },

        "textStyleStroke": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                Project.ensureTextStyle(item);
                item.node.style.stroke = v;
            }
        },

        "textStyleStrokeThickness": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                Project.ensureTextStyle(item);
                item.node.style.strokeThickness = v;
            }
        },

        "textStyleStrokeLinejoin": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                Project.ensureTextStyle(item);
                item.node.style.lineJoin = v;
            }
        },

        "textStyleDropShadow": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                Project.ensureTextStyle(item);
                item.node.style.dropShadow = !!v;
            }
        },

        "textStyleDropShadowColor": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                Project.ensureTextStyle(item);
                item.node.style.dropShadowColor = v;
            }
        },

        "textStyleDropShadowDistance": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                Project.ensureTextStyle(item);
                item.node.style.dropShadowDistance = v;
            }
        },

        "textStyleDropShadowAngle": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                Project.ensureTextStyle(item);
                item.node.style.dropShadowAngle = v;
            }
        },

        "textStyleDropShadowBlur": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                Project.ensureTextStyle(item);
                item.node.style.dropShadowBlur = v;
            }
        },

        "textStyleDropShadowOpacity": (item, v) => {
            if (item.node instanceof PIXI.Text) {
                Project.ensureTextStyle(item);
                item.node.style.dropShadowAlpha = v;
            }
        },

        "automationEnabled": (item, v) => item.data.automationEnabled = !!v,

        "automationBaseValue": (item, v) => {
            item.data.automationBaseValue = v;
            if(item.__automationClip) {
                item.__automationClip.startPoint.value = v;
                item.__automationClip.render();
            }
        },

        "automationFunction": (item, v) => {
            if(typeof v === "string") {
                item.data.automationFunction = v;
                item.__dirtyMapping = true;
            } else if (typeof v === "function") {
                item.mappingFn = v;
                item.__dirtyMapping = false;
            }
        }
    }

    static nodePropertyGetters = {
        "tileColor": (item) => item.color,
        "clipDuration": (item) => item.duration,
        "clipStartTime": (item) => item.start,
        "positionX": (item) => item.node? item.node.position.x: (item.data.positionX || 0),
        "positionY": (item) => item.node? item.node.position.y: (item.data.positionY || 0),
        "scaleX": (item) => item.node? item.node.scale.x: (item.data.scaleX || 1),
        "scaleY": (item) => item.node? item.node.scale.y: (item.data.scaleY || 1),
        "rotation": (item) => item.node? item.node.rotation: (item.data.rotation || 0),
        "anchorX": (item) => item.node?.anchor? item.node.anchor.x: (item.data.anchorX?? 0),
        "anchorY": (item) => item.node?.anchor? item.node.anchor.y: (item.data.anchorY?? 0),
        "skewX": (item) => item.node? item.node.skew.x: (item.data.skewX || 0),
        "skewY": (item) => item.node? item.node.skew.y: (item.data.skewY || 0),
        "visible": (item) => item.node? item.node.visible: (item.data.visible !== undefined? item.data.visible: true),
        "tint": (item) => item.node? item.node.tint: (item.data.tint || 0xFFFFFF),
        "opacity": (item) => item.node? item.node.alpha: (item.data.opacity !== undefined? item.data.opacity: 1),
        "alpha": (item) => item.node? item.node.alpha: (item.data.alpha !== undefined? item.data.alpha: 1),
        "blendMode": (item) => item.node? item.node.blendMode: (item.data.blendMode || 0),
        "textContent": (item) => (item.node instanceof PIXI.Text)? item.node.text: (item.data.textContent || ""),
        "textStyle": (item) => (item.node instanceof PIXI.Text)? item.node.style: (item.data.textStyle || {}),
        "textStyleWeight": (item) => (item.node instanceof PIXI.Text)? item.node.style.fontWeight: (item.data.textStyleWeight || 'normal'),
        "textStyleStyle": (item) => (item.node instanceof PIXI.Text)? item.node.style.fontStyle: (item.data.textStyleStyle || 'normal'),
        "textStyleFontSize": (item) => (item.node instanceof PIXI.Text)? item.node.style.fontSize: (item.data.textStyleFontSize || 26),
        "textStyleFontFamily": (item) => (item.node instanceof PIXI.Text)? item.node.style.fontFamily: (item.data.textStyleFontFamily || 'Arial'),
        "textStyleFill": (item) => (item.node instanceof PIXI.Text)? item.node.style.fill: (item.data.textStyleFill || '#ffffff'),
        "textStyleAlignment": (item) => (item.node instanceof PIXI.Text)? item.node.style.align: (item.data.textStyleAlignment || 'left'),
        "textStyleLineHeight": (item) => (item.node instanceof PIXI.Text)? item.node.style.lineHeight: (item.data.textStyleLineHeight || 0),
        "textStyleWrapWidth": (item) => (item.node instanceof PIXI.Text)? item.node.style.wordWrapWidth: (item.data.textStyleWrapWidth || 100),
        "textStyleWrap": (item) => (item.node instanceof PIXI.Text)? item.node.style.wordWrap: (!!item.data.textStyleWrap),
        "textStyleLetterSpacing": (item) => (item.node instanceof PIXI.Text)? item.node.style.letterSpacing: (item.data.textStyleLetterSpacing || 0),
        "textStyleStroke": (item) => (item.node instanceof PIXI.Text)? item.node.style.stroke: (item.data.textStyleStroke || '#000000'),
        "textStyleStrokeThickness": (item) => (item.node instanceof PIXI.Text)? item.node.style.strokeThickness: (item.data.textStyleStrokeThickness || 0),
        "textStyleStrokeLinejoin": (item) => (item.node instanceof PIXI.Text)? item.node.style.lineJoin: (item.data.textStyleStrokeLinejoin || 'miter'),
        "textStyleDropShadow": (item) => (item.node instanceof PIXI.Text)? item.node.style.dropShadow: (!!item.data.textStyleDropShadow),
        "textStyleDropShadowColor": (item) => (item.node instanceof PIXI.Text)? item.node.style.dropShadowColor: (item.data.textStyleDropShadowColor || '#000000'),
        "textStyleDropShadowDistance": (item) => (item.node instanceof PIXI.Text)? item.node.style.dropShadowDistance: (item.data.textStyleDropShadowDistance || 5),
        "textStyleDropShadowAngle": (item) => (item.node instanceof PIXI.Text)? item.node.style.dropShadowAngle: (item.data.textStyleDropShadowAngle || Math.PI / 6),
        "textStyleDropShadowBlur": (item) => (item.node instanceof PIXI.Text)? item.node.style.dropShadowBlur: (item.data.textStyleDropShadowBlur || 0),
        "textStyleDropShadowOpacity": (item) => (item.node instanceof PIXI.Text)? item.node.style.dropShadowAlpha: (item.data.textStyleDropShadowAlpha || 1),
        "automationEnabled": (item) => !!item.data.automationEnabled,
        "automationBaseValue": (item) => item.data.automationBaseValue || 0,
        "automationFunction": (item) => item.data.automationFunction || ""
    }
}


/**
 * Command interface
 * Represents a command that can be executed, undone, and redone
 */
class Command {
    do() {
        throw new Error("Command.do() must be implemented");
    }

    undo() {
        throw new Error("Command.undo() must be implemented");
    }

    redo() {
        this.do();
    }
}


/**
 * HistoryManager class
 * Manages the undo/redo history of a project
 */
class HistoryManager {
    MAX_HISTORY = 100;

    history = [];
    undoIndex = -1; // Points to the last executed command
    saveIndex = -1; // Points to the command that was last saved

    get unsavedChanges() {
        return this.undoIndex !== this.saveIndex;
    }

    execute(command) {
        if(typeof command.do === "function") command.do();

        // If we are not at the end of the history, remove all future commands (redo history)
        if (this.undoIndex < this.history.length - 1) {
            this.history.splice(this.undoIndex + 1);
        }

        this.history.push(command);
        this.undoIndex++;

        // Maintain max history size
        if(this.history.length > this.MAX_HISTORY) {
            this.history.shift();
            this.undoIndex--;
            this.saveIndex--; // Adjust save index if history shifts
        }

        this.updateButtons();
    }

    undo() {
        if (this.undoIndex < 0) return;

        const cmd = this.history[this.undoIndex];
        if(typeof cmd.undo === "function") cmd.undo();

        if(cmd.source && typeof cmd.source.applyUndo === "function") {
            cmd.source.applyUndo(cmd);
        }

        this.undoIndex--;
        this.updateButtons();
    }

    redo() {
        if (this.undoIndex >= this.history.length - 1) return;

        this.undoIndex++;
        const cmd = this.history[this.undoIndex];
        
        if(typeof cmd.do === "function") cmd.do(); // Or redo() if distinct

        if(cmd.source && typeof cmd.source.applyRedo === "function") {
            cmd.source.applyRedo(cmd);
        }

        this.updateButtons();
    }

    updateButtons() {
        if(typeof undoButton !== "undefined") {
            undoButton.classList.toggle("disabled", this.undoIndex < 0);
        }

        if(typeof redoButton !== "undefined") {
            redoButton.classList.toggle("disabled", this.undoIndex >= this.history.length - 1);
        }
    }

    markSaved() {
        this.saveIndex = this.undoIndex;
    }

    reset() {
        this.history.length = 0;
        this.undoIndex = -1;
        this.saveIndex = -1;
        this.updateButtons();
    }

    destroy() {
        this.reset();
    }
}


/**
 * View class
 * Base class for all views
 */
class View extends LS.EventHandler {
    constructor({ container, name, title } = {}) { 
        super();

        this.container = container;
        this.container.classList.add('editor-view');
        this.__name = name || null;
        this.title = title || null;

        this.currentSlot = null;
    }

    // Subclasses should override with their own destruction logic, but DON'T forget to call super.destroy()
    destroy() {
        this.emit('destroy');
        this.container.remove();
        this.events.clear();
        this.__destroyed = true;
        if(this.currentSlot) {
            this.currentSlot.set(null);
        }
    }
}


/**
 * Dragstate class
 * Just manages the drag animation for various draggable elements
 */

const dragState = new class DragState extends LS.Util.FrameScheduler {
    constructor() {
        super((deltaTime, ts) => this.#render(deltaTime, ts), { deltaTime: true });
        this.labelElement = LS.Create("span", { inner: "" });
        this.iconElement = LS.Create("i");
        this.previewContainer = LS.Create("ls-box", { class: 'layout-slot-drag-preview', inner: [ this.iconElement, this.labelElement ] });
        this.reset();
    }

    #render(deltaTime) {
        const delta = deltaTime * 0.1;

        if(!this.firstFrame && this.x !== this.prevX) { this.velocityX = this.x - this.prevX; } else { this.velocityX += (this.velocityX > 0? -delta: delta); }
        if(!this.firstFrame && this.y !== this.prevY) { this.velocityY = this.prevY - this.y; } else { this.velocityY += (this.velocityY > 0? -delta: delta); }
        this.previewContainer.style.transform = `translate3d(${this.x - this.clientWidthD}px, ${this.y + this.velocityY}px, 0) rotate(${this.velocityX}deg)`;

        this.prevX = this.x;
        this.prevY = this.y;

        // We need to wait a frame before we calculate the width
        if(this.firstFrame) {
            LS._topLayer.appendChild(this.previewContainer);
            this.previewContainer.style.transition = "transform 100ms ease-out";
            this.clientWidthD = this.previewContainer.clientWidth / 2;
            this.firstFrame = false;
        }
    }

    setPosition(x, y) {
        this.x = x || 0;
        this.y = y || 0;
    }

    reset() {
        this.x = 0;
        this.y = 0;
        this.velocityX = 0;
        this.velocityY = 0;
        this.prevX = 0;
        this.prevY = 0;
        this.firstFrame = true;
        this.clientWidthD = 0;
        this.target = null;
    }

    setTarget(target) {
        this.reset();
        this.target = target;

        const icon = ((target instanceof Slot)? "bi-columns-gap": target.icon || "bi-puzzle");
        const title = ((target instanceof Slot)? target.__titleElement.innerText: (target.title || target.name || target.label || target.__name || target.constructor.name));

        this.iconElement.className = icon;
        this.labelElement.textContent = " " + title;
        this.previewContainer.style.transition = "none";
    }

    start(target = null, x = 0, y = 0) {
        if(target) {
            this.setTarget(target);
        }
        this.setPosition(x, y);
        super.start();
    }

    stop() {
        super.stop();
        this.firstFrame = true;
        this.previewContainer.remove();
    }
}


/**
 * Slot class
 * Represents a slot in the layout where views can be placed
 */
class Slot {
    constructor(options = {}) {
        this.options = options;
        this.expectedView = options.view || null;
        this.currentView = null;

        this.__emptyMessage = LS.Create({ class: 'editor-view layout-slot-empty', inner: [{ tag: "i", class: "bi-info-circle" }, `This slot is empty.`] });

        this.container = LS.Create({
            tag: "layout-item",
            class: 'layout-slot',
            inner: [
                this.__header = N({ class: "layout-slot-header", inner: [
                    [
                        { tag: "svg", attributes: {
                            xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 256 256",
                            width: "16", height: "16",
                            fill: "currentColor"
                        }, innerHTML: `<path d="M108,60A16,16,0,1,1,92,44,16,16,0,0,1,108,60Zm56,16a16,16,0,1,0-16-16A16,16,0,0,0,164,76ZM92,112a16,16,0,1,0,16,16A16,16,0,0,0,92,112Zm72,0a16,16,0,1,0,16,16A16,16,0,0,0,164,112ZM92,180a16,16,0,1,0,16,16A16,16,0,0,0,92,180Zm72,0a16,16,0,1,0,16,16A16,16,0,0,0,164,180Z"></path>` }, this.__titleElement = LS.Create({ tag: "span", inner: "Empty slot" })
                    ],
                    [
                        { tag: "button", class: "square clear small layout-slot-close-button", inner: { tag: "i", class: "bi-x-lg" }, onclick: () => {
                            this.set(null);
                        } }
                    ]
                ]}),
                this.__emptyMessage
            ]
        });

        this.container._slotInstance = this;

        this.handle = new LS.Util.TouchHandle(this.__header, {
            cursor: "grabbing",
            disablePointerEvents: false,

            onStart: (event) => {
                Slot.draggedSlot = this;
                Slot.dropTarget = null;

                dragState.start(this, event.x, event.y);
            },

            onMove: (event) => dragState.setPosition(event.x, event.y),

            onEnd: () => {
                Slot.draggedSlot = null;
                if(Slot.dropTarget) {
                    this.swapWith(Slot.dropTarget);
                    Slot.dropTarget.container.classList.remove('layout-slot-drop-target');
                    Slot.dropTarget = null;
                }

                dragState.stop();
            },
        });

        this.container.addEventListener('mouseenter', this.__mouseEnter = () => {
            this.container.addEventListener('mouseleave', this.__mouseLeave);
            if(Slot.draggedSlot && Slot.draggedSlot !== this) {
                this.container.classList.add('layout-slot-drop-target');
                Slot.dropTarget = this;
            }
        });

        this.__mouseLeave = () => {
            this.container.removeEventListener('mouseleave', this.__mouseLeave);
            if(Slot.draggedSlot && Slot.draggedSlot !== this) {
                this.container.classList.remove('layout-slot-drop-target');
                Slot.dropTarget = null;
            }
        }

        if(options.minSize) {
            this.container.style.minWidth = options.minSize.width + 'px';
            this.container.style.minHeight = options.minSize.height + 'px';
        }

        if(options.maxSize) {
            this.container.style.maxWidth = options.maxSize.width + 'px';
            this.container.style.maxHeight = options.maxSize.height + 'px';
        }

        if(options.width) {
            this.container.style.width = options.width + (typeof options.width === "number"? 'px': '');
        }

        if(options.height) {
            this.container.style.height = options.height + (typeof options.height === "number"? 'px': '');
        }
    }

    set(view) {
        const oldView = this.currentView;
        
        for(const child of this.container.children) {
            if(child === this.__header || child.classList.contains('ls-resize-handle')) continue;
            child.remove();
        }

        if(oldView) {
            oldView.currentSlot = null;
        }

        this.currentView = view;

        if(!view || view.__destroyed) {
            this.container.appendChild(this.__emptyMessage);
            this.__titleElement.innerText = "Empty slot";
            if(view && view.__destroyed) {
                console.warn(`Slot.set: cannot set destroyed view ${view.constructor.name} to slot ${this.name}`);
                view.currentSlot = null;
                return;
            }
            return;
        }

        this.__titleElement.innerText = view.title || view.__name || view.constructor.name;
        view.currentSlot = this;

        this.container.appendChild(view.container);
    }

    swapWith(otherSlot) {
        const myView = this.currentView;
        const otherView = otherSlot.currentView;
        
        otherSlot.set(myView);
        this.set(otherView);
    }

    destroy() {
        this.container.removeEventListener('mouseenter', this.__mouseEnter);
        this.container.removeEventListener('mouseleave', this.__mouseLeave);
        this.container.remove();
        this.container = null;
        this.handle.destroy();
        this.handle = null;
        this.options = null;
        this.__emptyMessage = null;
        this.__header = null;
        this.__titleElement = null;
        this.__destroyed = true;
    }
}


const LAYOUT_SCHEMA_PRESETS = {
    /**
     * |   |   |
     * |-------|
     * |   |   |
     */
    'default': {
        title: "Default",
        direction: 'column',
        inner: [
            // Two horizontal rows
            { inner: [{ type: 'slot', view: 'PropertyEditorView', resize: { width: 600 } }, { type: 'slot', view: 'PreviewView' }], resize: { height: "60%" } },
            { type: "tabs", tabs: [ [{ type: 'slot', view: 'AssetManagerView', resize: { width: 420 } }, { type: 'slot', view: 'TimelineView' }], [{ type: 'slot' }] ] },
        ]
    },

    /**
     * |   | | |
     * |   |---|
     * |   |   |
     */
    'vertical-split': {
        title: "Vertical Split",
        direction: 'row',
        inner: [
            { type: 'slot', view: 'TimelineView' },
            {
                inner: {
                    direction: 'column',
                    inner: [{ direction: "row", inner: [{ type: 'slot', view: 'PreviewView' }, { type: 'slot', view: 'PropertyEditorView' }] }, { type: 'slot', view: 'AssetManagerView' }]
                }
            }
        ]
    },

    /**
    * |       |
    * |-------|
    * |       |
    */
    'simple-horizontal': {
        title: "Simple Horizontal",
        direction: 'column',
        inner: [
            { type: 'slot', view: 'PreviewView', resize: { height: "50%" } },
            { type: 'slot', view: 'TimelineView' }
        ]
    },

    /**
    * |   |   |
    * |   |   |
    * |   |   |
    */
    'simple-vertical': {
        title: "Simple Vertical",
        direction: 'row',
        inner: [
            { type: 'slot', view: 'PreviewView', resize: { width: "50%" } },
            { type: 'slot', view: 'TimelineView' }
        ]
    },

    /**
    * |       |
    * |-------|
    * | | | | |
    */
    'preview-focused': {
        title: "Preview Focused",
        direction: 'column',
        inner: [
            { type: 'slot', view: 'PreviewView', resize: { height: "70%" } },
            {
                direction: 'row',
                inner: [
                    { type: 'slot', view: 'TimelineView', resize: { width: "60%" } },
                    { type: 'slot', view: 'PropertyEditorView', resize: { width: "25%" } },
                    { type: 'slot', view: 'AssetManagerView' }
                ]
            }
        ]
    },

    /**
    * | |     |
    * | |-----|
    * | |     |
    */
    'sidebar-left': {
        title: "Sidebar Left",
        direction: 'row',
        inner: [
            { type: 'slot', view: 'AssetManagerView', resize: { width: 250 } },
            {
                direction: 'column',
                inner: [
                    { type: 'slot', view: 'PreviewView', resize: { height: "60%" } },
                    { type: 'slot', view: 'TimelineView' }
                ]
            }
        ]
    },

    /**
    * |     |  |
    * |-----|--|
    * |     |  |
    */
    'sidebar-right': {
        title: "Sidebar Right",
        direction: 'row',
        inner: [
            {
                direction: 'column',
                inner: [
                    { type: 'slot', view: 'PreviewView', resize: { height: "60%" } },
                    { type: 'slot', view: 'TimelineView' }
                ]
            },
            { type: 'slot', view: 'PropertyEditorView', resize: { width: 300 } }
        ]
    },

    /**
    * | |   | |
    * | |   | |
    * | |   | |
    */
    'three-column': {
        title: "Three Column",
        direction: 'row',
        inner: [
            { type: 'slot', view: 'AssetManagerView', resize: { width: "25%" } },
            { type: 'slot', view: 'PreviewView', resize: { width: "50%" } },
            { type: 'slot', view: 'PropertyEditorView' }
        ]
    },

    /**
    * |   |   |
    * |-------|
    * |   |   |
    * |-------|
    * |   |   |
    */
    'grid-2x3': {
        title: "Grid 2x3",
        direction: 'column',
        inner: [
            { inner: [{ type: 'slot', view: 'PreviewView', resize: { width: "50%" } }, { type: 'slot', view: 'PropertyEditorView' }], resize: { height: "33%" } },
            { inner: [{ type: 'slot', resize: { width: "50%" } }, { type: 'slot' }], resize: { height: "34%" } },
            { inner: [{ type: 'slot', view: 'AssetManagerView', resize: { width: "50%" } }, { type: 'slot', view: 'TimelineView' }] }
        ]
    },

    /**
     * |   |   |
     * |-------|
     * |   |   |
     */
    'default-but-better': {
        title: "Secret",
        direction: 'column',
        tilt: Math.floor(Math.random() * 17 + 28),
        inner: [
            // Two horizontal rows
            { inner: [{ type: 'slot', view: 'PreviewView', resize: { width: 600 } }, { type: 'slot', view: 'PropertyEditorView' }], resize: { height: "65%" } },
            { inner: [{ type: 'slot', view: 'TimelineView', resize: { width: 420 } }, { type: 'slot', view: 'AssetManagerView' }] },
        ]
    },
};


/**
 * Main Layout Manager
 * 
 * HOW LAYOUTS WORK:
 * LayoutManager manages a schema and a set of slots.
 * Views can specify an array of slot names where they want to be placed, in order.
 * 
 * The schema defines the layout structure, which can be virtually any combination with an unlimited amount of slots.
 */
class LayoutManager {
    constructor(container, options = {}) {
        this.container = container || document.body;
        this.options = options;

        this.views = new Set();
        this.slots = new Set();
        this.destroyables = new Set();

        this.__schemaLoaded = false;
        this.setSchema(options.layout || 'default');
    }

    static cloneSchema(schema) {
        function replacer(key, value) {
            if (value instanceof Slot) {
                return { type: 'slot', view: value.expectedView, ...value.options? { options: value.options }: {}, ...value.resize? { resize: value.resize }: {} };
            }
            return value;
        }

        return JSON.parse(JSON.stringify(schema, replacer));
    }

    add(...views) {
        for (const view of views) {
            if (!(view instanceof View)) {
                console.error("LayoutManager.add: view must be an instance of View");
                return;
            }

            this.views.add(view);
        }

        this.render();
    }

    render() {
        for (const slot of this.slots) {
            if (!slot.expectedView) continue;

            // Find the view
            let foundView = null;
            for (const view of this.views) {
                const viewName = view.__name || view.constructor.name;
                if (viewName === slot.expectedView) {
                    foundView = view;
                    break;
                }
            }

            if (foundView) {
                slot.set(foundView);
            }
        }
    }

    setSchema(schema) {
        if(typeof schema === "string") {
            schema = LAYOUT_SCHEMA_PRESETS[schema];
        }

        if(!schema || (typeof schema !== "object")) {
            if(this.__schemaLoaded) {
                console.error("LayoutManager.setSchema: valid schema is required");
                return false;
            }

            console.warn("LayoutManager.setSchema: invalid schema provided, using default");
            schema = LAYOUT_SCHEMA_PRESETS['default'];
        }

        // Make a deep copy of the schema and set it as the current working schema
        schema = LayoutManager.cloneSchema(schema);
        this.schema = schema;

        for(const child of this.container.children) {
            child.remove();
        }

        for(const slot of this.slots) {
            if(slot.container) {
                LS.Resize.remove(slot.container); // Removes any resize handlers
                if(slot.destroy) slot.destroy();
            }
        }

        for(const item of this.destroyables) {
            item.destroy();
        }
        this.destroyables.clear();

        this.slots.clear();
        this.container.appendChild(this._processSchema(this.schema));

        this.__schemaLoaded = true;
        this.render();
        return true;
    }

    getAvailableLayouts() {
        const layouts = [];
        for (const key in LAYOUT_SCHEMA_PRESETS) {
            layouts.push({
                name: key,
                title: LAYOUT_SCHEMA_PRESETS[key].title || key,
                schema: LayoutManager.cloneSchema(LAYOUT_SCHEMA_PRESETS[key])
            });
        }
        return layouts;
    }

    _processSchema(schema) {
        if (schema instanceof Slot || (schema.type && schema.type === 'slot')) {
            if (!(schema instanceof Slot)) {
                schema = new Slot(schema.options || schema);
            }

            this.slots.add(schema);
            return schema.container;
        }

        if (schema.type === 'tabs') {
            const container = LS.Create("layout-item", { class: "editor-tabs" });
            const tabs = new LS.Tabs(container, {
                list: true,
                styled: false
            });

            if(schema.tabs) {
                let i = 0;
                for(const tabData of schema.tabs) {
                    let title = tabData.title || `Tab ${i + 1}`;
                    let contentNode;

                    if (Array.isArray(tabData)) {
                        contentNode = this._processSchema({ inner: tabData, direction: schema.direction || 'row' });
                    } else {
                        contentNode = this._processSchema(tabData);
                    }
                    
                    tabs.add(title, contentNode);
                    i++;
                }
                tabs.set(0);
            }

            this.destroyables.add(tabs);
            return container;
        }

        const direction = schema.direction || "row";
        const container = LS.Create({ tag: "layout-item", class: 'layout-' + direction, ...schema.tilt? { style: `transform:rotate(${schema.tilt}deg)` }: {} });

        if(Array.isArray(schema.inner)) {
            let i = 0;
            for (const item of schema.inner) {
                const child = this._processSchema(item);
                container.appendChild(child);

                if(i !== schema.inner.length - 1) {
                    LS.Resize.set(child, {
                        sides: direction === 'column'? ['bottom']: ['right'],

                        // Snapping
                        snapCollapse: true,
                        snapExpand: true,
                        snapVertical: direction === 'column',
                        snapHorizontal: direction === 'row',

                        // Storage
                        store: true,
                        storeStringify: false,
                        storage: {
                            getItem: (key) => {
                                return item.resize || null;
                            },
                            setItem: (key, value) => {
                                item.resize = value;
                            }
                        }
                    });

                    if(!item.resize) child.style[direction === 'column'? 'height': 'width'] = (100 / schema.inner.length) + '%';
                }

                i++;
            }
        } else if (schema.inner) {
            container.appendChild(this._processSchema(schema.inner));
        }

        return container;
    }

    exportLayout(asString = false) {
        const exported = {
            schema: LayoutManager.cloneSchema(this.schema)
        }

        return asString? JSON.stringify(exported): exported;
    }

    importLayout(data) {
        if (typeof data === "string") {
            data = JSON.parse(data);
        }

        if (!data.schema) {
            console.error("LayoutManager.importLayout: invalid layout data");
            return;
        }

        this.setSchema(data.schema);
        this.render();
    }
}


/**
 * ConfigStore class
 * Temporarily using localStorage
 */
class ConfigStore {
    constructor() {
        this.store = new Map();

        // Load existing config from localStorage
        for (const key in localStorage) {
            if (key.startsWith('config-')) {
                const configKey = key.substring(7);
                try {
                    const value = JSON.parse(localStorage.getItem(key));
                    this.store.set(configKey, value);
                } catch (e) {
                    console.warn(`ConfigStore: Failed to parse config item ${configKey}`, e);
                }
            }
        }
    }

    set(key, value) {
        this.store.set(key, value);
        localStorage.setItem(`config-${key}`, JSON.stringify(value));
    }

    get(key, defaultValue = null) {
        return this.store.get(key) || defaultValue;
    }

    has(key) {
        return this.store.has(key);
    }

    delete(key) {
        this.store.delete(key);
        localStorage.removeItem(`config-${key}`);
    }

    clear() {
        this.store.clear();
        // Remove all config items from localStorage
        for (const key in localStorage) {
            if (key.startsWith('config-')) {
                localStorage.removeItem(key);
            }
        }
    }

    export(asString = false) {
        const exported = {};
        for (const [key, value] of this.store.entries()) {
            exported[key] = value;
        }
        if (asString) {
            return JSON.stringify(exported);
        }
        return exported;
    }

    import(data) {
        if (typeof data === "string") {
            data = JSON.parse(data);
        }

        for (const key in data) {
            this.set(key, data[key]);
        }
    }
}


/**
 * Video encoder class
 * 
 * Types:
 * - FFMPEG (WebAssembly) / native on Node.js
 * - WebCodecs API
 * - MediaRecorder API
 * - none (image sequence only)
 */
class VideoEncoder {
    /**
     * Creates a video encoder
     * @param {*} project Target project to render
     * @param {*} options Encoding options
     * @param {number} options.fps Frames per second
     * @param {boolean} options.alpha Whether to include alpha channel
     * @param {string} options.type Encoding type: 'ffmpeg', 'webcodecs', 'mediarecorder', 'none'
     * @param {boolean} options.audio Whether to include an audio stream (if supported)
     */
    constructor(project, options = {}) {
        this.project = project;
        this.options = LS.Util.defaults({
            fps: 30,
            alpha: false,
            type: 'webcodecs', // 'ffmpeg', 'webcodecs', 'mediarecorder', 'none'
            audio: true
        }, options);

        switch(this.options.type) {
            case 'ffmpeg':
                if(!isNode && !FFMPEG.isLoaded()) {
                    console.warn("VideoEncoder: FFMPEG is not loaded, falling back to WebCodecs");
                    this.options.type = 'webcodecs';
                }
                break;

            case 'webcodecs':
                if(!('VideoEncoder' in window)) {
                    console.warn("VideoEncoder: WebCodecs API is not supported, falling back to MediaRecorder");
                    this.options.type = 'mediarecorder';
                }
                break;

            case 'mediarecorder':
                if(!('MediaRecorder' in window)) {
                    console.warn("VideoEncoder: MediaRecorder API is not supported, falling back to image sequence only");
                    this.options.type = 'none';
                }
                break;
        }
    }

    extractFrame(renderer, pixels) {
        switch(renderer.type) {
            case PIXI.RendererType.WEBGL:
                const gl = renderer.gl;
                gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, this.options.alpha? gl.RGBA: gl.RGB, gl.UNSIGNED_BYTE, pixels);
                break;

            case PIXI.RendererType.WEBGPU:
                
                break;

            // This one doesn't exist in PIXI v8 and probably won't be added again
            case PIXI.RendererType.CANVAS: break;
        }
    }

    renderFrames(startTime, endTime) {
        const frameDuration = 1000 / (this.options.fps || 30);
        const totalFrames = Math.ceil((endTime - startTime) / frameDuration);

        for(let i = 0; i < totalFrames; i++) {
            const currentTime = startTime + i * frameDuration;
            this.project.renderAtTime(currentTime);

            // Extract frame pixels and feed to an encoder
            const width = this.project.renderer.renderer.width;
            const height = this.project.renderer.renderer.height;
            const pixelSize = this.options.alpha? 4: 3;
            const pixels = new Uint8Array(width * height * pixelSize);
            this.extractFrame(this.project.renderer.renderer, pixels);
            this.digest({ time: currentTime, pixels, width, height });
        }
    }

    digest(frame) {
        // ...
    }
}



// Export classes
window.EditorBaseClasses = {
    View,
    LayoutManager,
    Project,
    ConfigStore,
    VideoEncoder,
    Slot,
    HistoryManager,
    Command,
    dragState,
};

window.isNode = isNode;