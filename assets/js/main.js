
// Globals
let bay, bayElement, app;

// Create the "app" object
function build(){
    app = {

        container: LS.Present("main", O("#videoContainer"), {
            fullscreen: false,
            ignoreEvents: true,

            get containerWidth(){
                return O("#preview").clientWidth
            },

            get containerHeight(){
                return O("#preview").clientHeight - ( (app? app.ui.isFullscreen: false)? 0 : O("#controls").clientHeight)
            }
        }),

        ui: {
            isFullscreen: false,

            timeline: LS.Timeline("main", O("#mainTimeline"), {
                label(value, repeat, multiplier, scroll){
                    let values = [];
                    for(let i = 0; i < repeat; i++){
                        let seconds = value + (i * multiplier);
                        values.push(value + i == 0 ? "" : seconds+"s") // < 60 ? `${seconds}s` : seconds < 3600 ? `${(seconds / 60).toFixed(2)}m` : seconds < 86400 ? `${(seconds / 3600).toFixed(2)}h` : `${(seconds / 86400).toFixed(2)}d`)
                    }
                    return values
                },
                baseValue: 60 // Currently needed due to bugs in the code (calculation of zoomMultiplier)
            }),

            keyframes: LS.Timeline("keyframes", O("#keyframes"), {
                label(value, repeat, multiplier, scroll){
                    let values = [];
                    for(let i = 0; i < repeat; i++){
                        let percentage = value + (i * multiplier);
                        values.push(percentage == 0 ? "" : percentage + "%")
                    }
                    return values
                },
                baseValue: 60, // Currently needed due to bugs in the code (calculation of zoomMultiplier)
                max: 6000,
                length: 6000,
                resize: false,
                singlePoint: true,
                disableCrossing: true
            }),

            contextmenu: LS.Nav("contextmenu"),
            
            tabs: LS.Tabs("main", O("#tabs")),

            resourceEditorTabs: LS.Tabs("resourceEditor", O("#resourceEditorContent")),

            fullscreen(bool = null){
                if(bool === null) bool = !app.ui.isFullscreen;

                if(bool){
                    O("#preview").requestFullscreen()
                } else {
                    document.exitFullscreen()
                }
            },

            bay: LS.PatchBay("main", O("#bay")),

            resourceEmpty: O("#resourceEmpty"),
            resourceEditor: O("#resourceEditorContent"),

            editing: null,

            colorPicker: N("ls-select", {attr: "compatibility"}),

            updateScale(source){
                if(source != "resize") app.container.fixResolution()
                app.ui.aidBoxUpdate();
            },

            aidBoxUpdate(){
                let target = app.project.editingTarget;

                if(!target) return O("#aidBox").hide();

                let box = app.container.element.getBoundingClientRect(),
                    editBox = target.element.getBoundingClientRect()
                ;

                O("#aidBox").applyStyle({
                    display: "block",
                    left: box.left +"px",
                    top: box.top +"px",
                    width: box.width +"px",
                    height: box.height +"px",
                })

                O("#editAid").applyStyle({
                    left: editBox.left - box.left +"px",
                    top: editBox.top - box.top +"px",
                    width: editBox.width +"px",
                    height: editBox.height +"px",
                })


            },
            
            editorUpdate(){
                let target = app.project.editingTarget;

                if(!target) return;

                let editBox = target.element.getBoundingClientRect();

                let w = target.element.style.width === "unset" || target.element.style.width === "" ? "" : (editBox.width / app.container.scale).toFixed(2),
                    h = target.element.style.height === "unset" || target.element.style.height === "" ? "" : (editBox.height / app.container.scale).toFixed(2)
                ;

                if(O("#editor-x")) O("#editor-x").value = target.x;
                if(O("#editor-y")) O("#editor-y").value = target.y;
                if(O("#editor-w")) O("#editor-w").value = w;
                if(O("#editor-h")) O("#editor-h").value = h;
                if(O("#editor-s")) O("#editor-s").value = app.time.editorUseFrameUnits? target.position.start : target.position.start / app.time.fps;
                if(O("#editor-d")) O("#editor-d").value = app.time.editorUseFrameUnits? target.position.length : target.position.length / app.time.fps;

                O("#editor-unit-s")[app.time.editorUseFrameUnits? "delAttr" : "attrAssign"]("ls-selected")
                O("#editor-unit-f")[app.time.editorUseFrameUnits? "attrAssign" : "delAttr"]("ls-selected")
            },

            get currentContainer(){
                return app.ui.ensureContainer(app.time.timeline);
            },

            ensureContainer(id = app.time.timeline){
                let slide = O("#slide-" + id);

                if(!slide) {
                    app.presentation.addSlide(id)
                    slide = O("#slide-" + id)
                }

                return slide
            },

            get editorSide(){
                return O().hasClass("editor-right")
            },

            set editorSide(toRight){
                O().class("editor-right", !!toRight)
                app.ui.updateScale()
            },

            _cuttingTool: false,

            get cuttingTool(){
                return app.ui._cuttingTool
            },

            set cuttingTool(value){
                value = !!value;
                app.ui._cuttingTool = value

                O("#mainTimeline").class("cutting", value)
                requestAnimationFrame(app.ui.cuttingFrame)
            },

            cuttingFrame(){
                O("ls-timeline-cutline").style.left = M.x - app.ui.timeline.element.offsetLeft + "px";

                if(app.ui.cuttingTool) requestAnimationFrame(app.ui.cuttingFrame)
            },

            action: {
                about(){
                    let aboutWindow = createWindow({
                        title: "About",
                        width: 550,
                        height: 500,
                        x: 50,
                        minWidth: 300
                    }, N("div", {
                        class: "window-about",
                        inner: [
                            N("img", {src: "/assets/icon-flat.svg", draggable: false, width: "200"}),
                            N("h1", "<br>Revie<span style=color:#3692FF>Weave</span>"),
                            N("h3", "Made by <a target=_blank href=https://beta.lstv.space ls-accent=orange>LSTV</a>"),
                            N("span", {style: "text-align: left; display: block;" , inner: `<br><ls-box class=color ls-accent=orange>Please note that this is an unreleased product in a development state, branding or any features might be changed at any point without prior warning and might not hold up to standards.</ls-box>\n\nRevie is a Free and Open Source (FOSS) video/animation/compose editor developed by LSTV.<br>It is built using the LS Framework (also by LSTV).<br><br>It's the world's first video editor with built-in code support to allow you to edit your videos programatically!<br>The editor also features filters, custom composition effects, vector support, and some advanced renderers for custom graphics.<br><br>This is an alpha version - bugs are expected, and performance (to put it lightly) is terrible.<br><br><br><br><h2>Credits, licences</h2><br>At this moment, 100% of the editor code, layout and styles are written by LSTV.<br><br>3rd party libraries:<br><ul><li>spark-md5 by Joseph Myers</li></ul>Other assets:<br><ul><li>Used fonts: "Ubuntu Mono", "JetBrains Mono", "Rubik" and "Poppins" all under the <a href="https://openfontlicense.org/">OFL</a>.</li></ul>...and special thanks to all the contributors to the Chromium and V8 projects. This project would not be possible without them.`})
                        ]
                    }))

                    aboutWindow.element.applyStyle({
                        left: (innerWidth/2) - 275 + "px",
                        top: (innerHeight/2) - 250 + "px"
                    })

                    aboutWindow.addToWorkspace()
                }
            }
        },

        presentation: {
            _presentationMode: false,

            get presentationMode(){
                return app.presentation._presentationMode;
            },

            set presentationMode(value){
                app.presentation._presentationMode = !!value
            },

            get slide(){
                return app.time.timeline
            },

            set slide(value){
                app.time.timeline = value
            },

            addSlide(number = null){
                let slide = number || (app.ui.timeline.timelines.push({items: {}, labels: {}}) + 1);

                console.log(slide);
                
                if(!O("#slide-" + slide)){
                    app.container.element.add(N("ls-slide", {id: "slide-" + slide}));
                    app.container.steps.tabs.rescan();
                    console.log(app.container.steps.tabs);
                }

                return slide
            },

            getSlides(){
                return app.ui.timeline.timelines
            }
        },

        async addTile(layout, data = {}){
            let log = O("#timelineOverlayLog");

            let element = N({
                inner: N("span", {inner: layout.label || data.value || ""}),
                attr: {"ls-accent": layout.color || "red"},
                class: "main-timeline-item"
            })

            ;(layout.row || O("ls-timeline-row")).add(element)

            let id = app.ui.timeline.item(element, data.id || M.GlobalID), type = data.type || null;
        
            if(data.file){
                // handle file types
                let file_type = data.file.type.replace(/\/.*/, "");

                switch(file_type){
                    case"image":case"video":case"audio":
                        type = file_type
                    break;
                }
            } else if(!type) {
                type = "text"
            }

            if(["image", "audio", "video"].includes(type)) {
                // Items to be added to the library

                let hash = await new Promise((resolve, fail) => {
                    let chunkText = N("span", {inner: "0"});
                    
                    var blobSlice = File.prototype.slice || File.prototype.mozSlice || File.prototype.webkitSlice,
                        file = data.file,
                        chunkSize = 2097152,
                        chunks = Math.ceil(file.size / chunkSize),
                        currentChunk = 0,
                        spark = new SparkMD5.ArrayBuffer(),
                        fileReader = new FileReader()
                    ;
    
                    log.add(" - done\n> Calculating file hash [", chunkText, `/${chunks} chunks]`)
    
                    fileReader.onload = function (e) {
                        spark.append(e.target.result);
                        currentChunk++;
                        chunkText.set(String(currentChunk))
    
                        if (currentChunk < chunks) {
                            loadNext();
                        } else {
                            resolve(spark.end())
                        }
                    }
    
                    fileReader.onerror = function () {
                        fail()
                    }
    
                    function loadNext() {
                        var start = currentChunk * chunkSize,
                            end = ((start + chunkSize) >= file.size) ? file.size : start + chunkSize;
    
                        fileReader.readAsArrayBuffer(blobSlice.call(file, start, end));
                    }
    
                    loadNext();
                })

                console.log(hash);
                
                // URL.createObjectURL(data.file)
            }

            log.add(" - done\n> Setting up the timeline")

            let videoElement;
            if(["image", "text", "video"].includes(type)) {
                // Visual elements only

                videoElement = N(({
                    image: "img",
                    video: "video"
                })[type] || "div", {
                    inner: type == "text" ? N({
                        style: {
                            background: "#ffffff"
                        },
                        inner: data.value || "",
                        class: "textContent"
                    }) : data.value || "",
                    id: "videoElement_" + id,
                    class: "videoElement_type_" + type,
                    style: {
                        display: "none",
                        position: "absolute",
                        ... type == "text" ? { fontSize: 80 + "px",  } : {},
                    },

                    ... type == "image" ? { src: URL.createObjectURL(data.file), draggable: false } : {},
                    ... type == "image" ? { src: URL.createObjectURL(data.file), draggable: false } : {},
                    ... type == "video" ? { src: URL.createObjectURL(data.file), onloadedmetadata(){
                        app.ui.timeline.timeline.items[id].length = (videoElement.duration * app.time.fps) / app.ui.timeline.zoom
                    } } : {},
                });
            }

            app.ui.timeline.timeline.items[id].start = layout.x / app.ui.timeline.zoom;
            app.ui.timeline.timeline.items[id].length = layout.width / app.ui.timeline.zoom;

            // Element object
            let x = 0, y = 0, width, height, transform = {rotate: "0deg", skew: "", scale: 1}, align = ["left", "top"];

            let animationsID = app.ui.keyframes.timelines.length + 1;
            app.ui.keyframes.currentTimeline = animationsID

            app.project.elements[id] = {
                element: videoElement,
                timelineElement: element,

                animationsID,

                animation: {
                    rows: []
                },

                id,

                timeline: app.time.timeline,

                get position(){
                    return app.ui.timeline.timeline.items[id]
                },
                get row(){
                    return app.ui.timeline.timeline.items[id].row
                },
                set row(value){
                    app.ui.timeline.timeline.items[id].row = value
                },
                get label(){
                    return element.get("span").innerText
                },
                set label(value){
                    element.get("span").innerText = value
                },
                get color(){
                    return element.attr("ls-accent")
                },
                set color(value){
                    element.attr("ls-accent", value)
                },
                get alignH(){
                    return align[0]
                },
                get alignV(){
                    return align[1]
                },
                set alignH(value){
                    console.log(value);
                    if(!["center", "left", "right"].includes(value)) return;
                    align[0] = value
                    updateTransform()
                    app.project.elements[id].x = x
                },
                set alignV(value){
                    if(!["center", "top", "bottom"].includes(value)) return;
                    align[1] = value
                    updateTransform()
                    app.project.elements[id].y = y
                },
                get x(){
                    return x
                },
                set x(value){
                    x = value
                    videoElement.style.left = `calc(${align[0]=="center"? "50%" : align[0]=="right"? "100%" : "0px"} + ${x}px)`
                    app.ui.aidBoxUpdate()
                },
                get y(){
                    return y
                },
                set y(value){
                    y = value
                    videoElement.style.top = `calc(${align[1]=="center"? "50%" : align[1]=="bottom"? "100%" : "0px"} + ${y}px)`
                    app.ui.aidBoxUpdate()
                },
                get width(){
                    return width
                },
                set width(value){
                    width = value
                    videoElement.style.width = width + (typeof value=="number"? "px" : "")
                    app.ui.aidBoxUpdate()
                },
                get height(){
                    return height
                },
                set height(value){
                    height = value
                    videoElement.style.height = height + (typeof value=="number"? "px" : "")
                    app.ui.aidBoxUpdate()
                },
                config: {
                    ... type == "text" ? { fontSize: 80, textFill: "#ffffff", textAlign: "left", fontFamily: "inherit", letterSpacing: 0 } : {}
                },
                transform: {
                    get rotate(){
                        return transform.rotate || ""
                    },
                    set rotate(value){
                        transform.rotate = value
                        updateTransform()
                    },
                    get skew(){
                        return transform.skew || ""
                    },
                    set skew(value){
                        transform.skew = value
                        updateTransform()
                    },
                    get scale(){
                        return transform.scale || ""
                    },
                    set scale(value){
                        transform.scale = value
                        updateTransform()
                    },
                },
                data,
                type
            }

            function updateTransform(){
                videoElement.style.transform = `translate(${align[0]=="center"? "-50%" : align[0]=="right"? "-100%" : "0px"}, ${align[1]=="center"? "-50%" : align[1]=="bottom"? "-100%" : "0px"})` + Object.keys(transform).map(key => `${key}(${transform[key]})`).filter(t => !t.includes("()")).join(" ")
                app.ui.aidBoxUpdate()
            }

            app.ui.currentContainer.add(videoElement)
            app.frame()
            app.updateZIndex()

            O("#timelineOverlay").hide();

            return app.project.elements[id]
        },

        updateZIndex(resource){
            if(!resource){
                for(let id in app.project.elements){
                    if(!app.project.elements.hasOwnProperty(id)) continue;
                    update(app.project.elements[id])
                }
            } else {
                update(resource)
            }
            
            function update(resource){
                if(resource.timeline !== app.time.timeline) return;
                if(resource.element){
                    resource.element.style.zIndex = (10000 + app.ui.timeline.rows) - resource.row
                }
            }
        },

        selectTile(id){
            if(app.ui.editing == id) return;

            let resource = app.project.elements[id];

            app.unselect(true)
            app.ui.editing = id;

            resource.element.show()

            app.ui.aidBoxUpdate();

            resource.timelineElement.class("selected");

            app.ui.resourceEmpty.hide();
            app.ui.resourceEditor.show();

            app.ui.keyframes.currentTimeline = resource.animationsID

            O("#resourceProperties").set([
                N("h2", resource.type + " element"),

                N("h3", "Timing"),
                N([
                    N([
                        "<span><i class=bi-circle-square></i> Time units:</span>",
                        N("ls-group", {attr: ["join"], inner: [
                            N("button", {inner: "Seconds", id: "editor-unit-s", onclick(){ app.time.editorUseFrameUnits = false; app.ui.editorUpdate() }}),
                            N("button", {inner: "Frames", id: "editor-unit-f", onclick(){ app.time.editorUseFrameUnits = true; app.ui.editorUpdate() }}),
                        ]})
                    ]),
                    N([ "<span><i class=bi-align-start></i> Start:</span>", N("input", {type: "number", id: "editor-s", min: 0, oninput(){ resource.position.start = +this.value * (app.time.editorUseFrameUnits? 1 : app.time.fps) }}) ]),
                    N([ "<span><i class=bi-stopwatch></i> Duration:</span>", N("input", {type: "number", id: "editor-d", min: 0, oninput(){ resource.position.length = +this.value * (app.time.editorUseFrameUnits? 1 : app.time.fps) }}) ]),
                    N([ "<span><i class=bi-tag></i> Label:</span>", N("input", {value: resource.label, oninput(){ resource.label = this.value }}) ]),
                    N([ "<span><i class=bi-palette2></i> Tile color:</span>", app.ui.colorPicker ]),
                ]),

                N("h3", "Position"),
                N([
                    N({style: "justify-content:space-evenly", inner: [
                        "Align: ",
                        N("ls-group", {attr: ["join", "radio", {value: resource.alignH}], inner: [
                            N("button", {inner: "<i class=bi-align-start></i>", value: "left", onclick(){ resource.alignH = "left"; app.ui.editorUpdate() }}),
                            N("button", {inner: "<i class=bi-align-center></i>", value: "center", onclick(){ resource.alignH = "center"; app.ui.editorUpdate() }}),
                            N("button", {inner: "<i class=bi-align-end></i>", value: "right", onclick(){ resource.alignH = "right"; app.ui.editorUpdate() }})
                        ]}),
                        N("ls-group", {attr: ["join", "radio", {value: resource.alignV}], inner: [
                            N("button", {inner: "<i class=bi-align-top></i>", value: "top", onclick(){ resource.alignV = "top"; app.ui.editorUpdate() }}),
                            N("button", {inner: "<i class=bi-align-middle></i>", value: "center", onclick(){ resource.alignV = "center"; app.ui.editorUpdate() }}),
                            N("button", {inner: "<i class=bi-align-bottom></i>", value: "bottom", onclick(){ resource.alignV = "bottom"; app.ui.editorUpdate() }}),
                        ]})
                    ]}),

                    N({style: "justify-content:space-evenly;flex-wrap:wrap", inner: [
                        N("ls-group", {style: "align-items:center", attr: ["join"], inner: [
                            "X&nbsp;" ,
                            N([ N("input", {style: "width: 80px", id: "editor-x", type: "number", oninput(){ resource.x = +this.value }}) ]),
                            N("button", {onclick(){ resource.x = 0; O("#editor-x").value = "0" }, inner: "<i class=bi-x></i>"}),
                        ]}),
                        N("ls-group", {style: "align-items:center", attr: ["join"], inner: [
                            "Y&nbsp;" ,
                            N([ N("input", {style: "width: 80px", id: "editor-y", type: "number", oninput(){ resource.y = +this.value }}) ]),
                            N("button", {onclick(){ resource.y = 0; O("#editor-y").value = "0" }, inner: "<i class=bi-x></i>"}),
                        ]}),
                        N("ls-group", {style: "align-items:center", attr: ["join"], inner: [
                            "<i class=bi-arrow-repeat></i>&nbsp;" ,
                            N([ N("input", {style: "width: 80px", id: "editor-r", type: "number", min: "-360", max: "360", value: resource.transform.rotate.replace("deg", ""), oninput(){ resource.transform.rotate = this.value + "deg"; app.ui.aidBoxUpdate() }}) ]),
                            N("button", {onclick(){ resource.transform.rotate = "0deg"; O("#editor-r").value = "0" }, inner: "<i class=bi-x></i>"}),
                        ]}),
                    ]}),

                    N({style: "justify-content:space-evenly;flex-wrap:wrap", inner: [
                        N("ls-group", {style: "align-items:center", attr: ["join"], inner: [
                            "W&nbsp;" ,
                            N("input", {style: "width: 80px", id: "editor-w", min: 0, type: "number", value: resource.width, oninput(){ resource.width = +this.value }}),
                            N("button", {onclick(){ resource.width = "unset"; O("#editor-w").value = "" }, inner: "<i class=bi-x></i>"}),
                        ]}),
                        N("ls-group", {style: "align-items:center", attr: ["join"], inner: [
                            "H&nbsp;",
                            N("input", {style: "width: 80px", id: "editor-h", min: 0, type: "number", value: resource.height, oninput(){ resource.height = +this.value }}),
                            N("button", {onclick(){ resource.height = "unset"; O("#editor-h").value = "" }, inner: "<i class=bi-x></i>"}),
                        ]}),
                        N("ls-group", {style: "align-items:center", attr: ["join"], inner: [
                            "<i class=bi-arrows-angle-expand></i>&nbsp;",
                            N("input", {style: "width: 80px", id: "editor-ts", min: -5, max: 200, step: .1, type: "number", value: resource.transform.scale, oninput(){ resource.transform.scale = +this.value }}),
                            N("button", {onclick(){ resource.transform.scale = 1; O("#editor-ts").value = "1" }, inner: "<i class=bi-x></i>"}),
                        ]}),
                    ]}),

                ]),

                ... resource.type == "text" ? [
                    N("h3", "Text"),
                    N([
                        N({ class: "multiline", inner: [ "Text:", N("textarea", {value: resource.element.get(".textContent").innerHTML, oninput(){ resource.element.get(".textContent").innerHTML = this.value; app.ui.aidBoxUpdate() }}) ]}),
                        N([
                            "Text style: ",
                            N("ls-group", {attr: ["join"], inner: [
                                N("button", {inner: "<i class=bi-type-bold></i>"}),
                                N("button", {inner: "<i class=bi-type-italic></i>"}),
                                N("button", {inner: "<i class=bi-type-underline></i>"}),
                            ]})
                        ]),
                        N([
                            "Text align: ",
                            N("ls-group", {attr: ["join", "radio", {value: resource.config.textAlign}], inner: [
                                N("button", {inner: "<i class=bi-align-start></i>", value: "left", onclick(){ resource.config.textAlign = "left"; resource.element.style.textAlign = "left" }}),
                                N("button", {inner: "<i class=bi-align-center></i>", value: "center", onclick(){ resource.config.textAlign = "center"; resource.element.style.textAlign = "center" }}),
                                N("button", {inner: "<i class=bi-align-end></i>", value: "right", onclick(){ resource.config.textAlign = "right"; resource.element.style.textAlign = "right" }})
                            ]})
                        ]),
                        N([ "Font: ", N("input", {value: resource.config.fontFamily, oninput(){ resource.config.fontFamily = this.value; resource.element.style.fontFamily = this.value; app.ui.aidBoxUpdate() }}) ]),
                        N([ "Font size: ", N("input", {type: "number", value: resource.config.fontSize, oninput(){ resource.config.fontSize = +this.value; resource.element.style.fontSize = this.value +"px"; app.ui.aidBoxUpdate() }}) ]),
                        N([ "Letter spacing: ", N("input", {type: "number", value: resource.config.letterSpacing, oninput(){ resource.config.letterSpacing = +this.value; resource.element.style.letterSpacing = this.value +"px"; app.ui.aidBoxUpdate() }}) ]),
                        N([ "Text color: ", N("input", {type: "color", value: resource.config.textFill, oninput(){ resource.config.textFill = this.value; resource.element.get(".textContent").style.background = this.value }}) ]),
                    ])
                ]: [],

                N("h3", "Custom properties"),
                N([
                    N("button", {style: "width:100%", inner: "<i class=bi-pencil-square></i>"}),
                    N("ls-group", {attr: ["join"], inner: [
                        N("input", {placeholder: "Property"}),
                        N("input", {placeholder: "Value"}),
                        N("button", "<i class=bi-trash-fill></i>")
                    ]}),
                    N("button", {style: "width:100%", inner: "<i class=bi-plus-lg></i>"})
                ]),
            ])

            app.ui.editorUpdate()

            LS.Select("color").set(LS.Select("color").getOptions().find(o=> o.value == resource.color))
        },

        unselect(noOverride = false){
            if(!noOverride) {
                app.ui.resourceEmpty.show("flex");
                app.ui.resourceEditor.hide();
            }
            Q(".ls-timeline-item").all().class("selected", 0);
            app.ui.editing = null;
            app.ui.aidBoxUpdate()
        },

        project: {
            elements: {},
            get editingTarget(){
                let resource = app.project.elements[app.ui.editing];
                if(resource && resource.timeline !== app.time.timeline) return null;

                return resource
            },

            library: {
                // 
            }
        },

        frame(at = app.time._current){
            if(at < 0) at = 0;
            if(at > app.time.total) at = app.time.total;

            app.time._current = at;
            app.ui.timeline.position = at;

            let intersect = app.ui.timeline.intersectingAt(at);
            for(let id in app.project.elements){
                if(!app.project.elements.hasOwnProperty(id)) continue;

                let resource = app.project.elements[id];
                if(resource.timeline !== app.time.timeline) continue;

                if(!app.playing && resource.type == "video"){
                    resource.element.currentTime =  (at - resource.position.start) / 60
                }

                resource.element.style.display = intersect.includes(id)? "block" : "none"
            }

            O("#time_current").set(app.time.minuteFormat(at))
        },

        toggle(){
            app.playing = !app.playing;
        },

        Player(ts){
            const elapsedMilliseconds = ts - app.time.playerTiming;
            const targetFrame = Math.floor((elapsedMilliseconds / 1000) * app.time.fps) + app.time.playerStart;

            if (targetFrame !== app.time.current) {
                app.frame(targetFrame);
            }

            if(targetFrame === app.time.total){
                app.playing = false
            }

            if(app.playing) requestAnimationFrame(app.Player)
        },

        pause(){

        },

        _playing: false,

        get playing(){
            return app._playing
        },

        set playing(value){
            value = !!value;

            if(value === app._playing) return;

            app._playing = value;
            O().class("player-playing", value)

            app.time.playerStart = app.time.current;
            app.time.playerTiming = performance.now();

            if(value) requestAnimationFrame(app.Player)
        },

        time: {
            fps: 60,
            frameSkip: 1,

            _current: 0,
            _total: 5000,

            editorUseFrameUnits: false,

            get timeline(){
                return app.ui.timeline.currentTimeline
            },

            set timeline(value){
                app.ui.ensureContainer(value)
                app.ui.timeline.currentTimeline = value
                app.container.navigate(value, true)
            },

            get second(){
                return app.time._current / app.time.fps
            },
            get current(){
                return app.time._current
            },
            get total(){
                return app.time._total
            },
            set total(value){
                app.time._total = value;
                app.ui.timeline.playerLength = value;
                O("#time_total").set(app.time.minuteFormat(value))
            },
            set current(value){
                app.frame(value)
            },

            minuteFormat(frames){
                let seconds = Math.floor(frames / app.time.fps),
                    secondsRemaining = seconds % 60,
                    minutesRemaining = Math.floor((seconds % (app.time.fps * 60)) / app.time.fps),
                    hours = Math.floor(seconds / 3600)
                ;

                return (hours > 0? hours + ":" + (minutesRemaining < 10 ? `0${minutesRemaining}` : minutesRemaining): minutesRemaining) + ":" + (secondsRemaining < 10 ? `0${secondsRemaining}` : secondsRemaining);
            }
        },

        util: {
            css2o(css){
                let result = {};
                let match;

                while ((match = (/([\w-]+)\s*:\s*([^;]+)\s*;/g).exec(css)) !== null) {
                    const property = match[1].trim();
                    const value = match[2].trim();
                    result[property] = value;
                }

                return result;
            },
            o2css(object){
                let string = "";

                for(const key in object){
                    if(!object.hasOwnProperty(key)) continue;
                    string += `${key}:${object[key]};`
                }

                return string
            }
        },

        handleFileDrop(isLibrary, event) {
            preventDefault(event);

            const files = event.dataTransfer.files;

            for (const file of files) {
                if(!isLibrary){
                    O("#timelineOverlay").show()
                    O("#timelineOverlayLog").clear().add("> Processing file");

                    app.addTile({
                        x: app.ui.timeline.container.scrollLeft + (M.x - app.ui.timeline.element.offsetLeft),
                        width: 120,
                        label: file.name,
                        row: document.elementsFromPoint(M.x, M.y).reverse().find(e => e.tagName == "LS-TIMELINE-ROW")
                    }, {
                        file: file
                    })
                }
            }
        },

    }
}

function preventDefault(event) {
    event.preventDefault();
    event.stopPropagation();
}

M.on("load", ()=>{
    setTimeout(()=>{
        O("#logo").class("jump")
        O("#app").show("flex")
        O("#load_circle").style.opacity = "0";

        setTimeout(() => O("#app").class("loaded"), 20)

        build()

        M.on("mousemove", ()=>{
            if(app.ui.isFullscreen){
                Q("body, #preview").all().class("show-controlls", M.y > innerHeight - 200)
            }
        })

        LS.Tooltips.on("set", (value)=>{
            O("#hint").show()
            O("#hint").set(value)
        })

        LS.Tooltips.on("leave", (value)=>{
            O("#hint").hide()
        })

        // cMenu.contextMenu(O(), N("ls-menu",[
        //     N("ls-option", "test")
        // ]))

        app.ui.bay.classes = {
            audio: {
                color: "red"
            },
            image: {
                color: "blue"
            },
            data: {
                color: "orange"
            }
        }

        app.ui.bay.element.getAll(".node").all((e)=>{
            let node = app.ui.bay.newNode(e)

            app.ui.bay.add(node)

            for(let source of e.getAll(".source")){
                node.addSource(source, {
                    isInput: O(source.parentElement).hasClass("input")
                })
            }

            e.getAll(".source").all().attrAssign({tabindex:4})
        })

        app.ui.dropResources = LS.DragDrop("resource", {
            clone: true,
            absoluteX: true,
            container: app.ui.timeline.container,
            allowedTargets: "main_timeline_drag"
        })

        app.ui.floatingTabs = LS.DragDrop("floating", {
            absoluteX: true,
            allowedTargets: "floating",
            swap: true,
            animate: false,
            relativeMouse: true,
            dropPreview: false
        })

        Q(".floatingTab").all((e)=>{
            app.ui.floatingTabs.enableDrag(e, e.get(".floatingHeader"))
        })

        Q("#topLeftArea, #bottomLeftArea").all((e)=>{
            app.ui.floatingTabs.enableDrop(e)
        })
    
        app.ui.timeline.dragDrop.on("drop", (source, target, event) => {
            if(event.source == "resource"){
                event.cancelPush();
                console.log("added resource", event)

                app.addTile({
                    width: event.boundWidth,
                    x: event.boundX,
                    row: target,
                    color: "green"
                }, {
                    value: "Some text"
                })
            }else{
                app.frame()
            }
        })

        app.ui.timeline.on("select", (element, id, position, event) => app.selectTile(id))

        app.ui.timeline.playerLength = app.time.total;
    
        for(let e of Q(".resource")){
            app.ui.dropResources.enableDrag(e)
        }

        app.ui.timeline.on("seek", value => {
            app.time.current = value
            app.unselect()
        })

        app.ui.timeline.on("rowchange", (element, id) => {
            let resource = app.project.elements[id];
            if(resource && resource.timeline !== app.time.timeline) return;

            app.updateZIndex(resource)
        })

        document.addEventListener('wheel', (event) => {
            if (event.ctrlKey && O("#aidBox").matches(":hover")) {
                event.preventDefault();

                O("#editor-ts").value = app.project.editingTarget.transform.scale += event.deltaY > 0 ? -.1 : .1

                // let zoomFactor = this.zoom * .16
                // this.zoom = this.zoom - (event.deltaY > 0 ? zoomFactor : -zoomFactor)
            }
        }, { passive: false });

        LS.Resize("tabs", O("#tabs"), [1], {snap: true}).on("resize", app.ui.updateScale)

        LS.Resize("bl", O("#bottomLeftArea"), [0, 0, 0, 1], {snap: true})

        LS.Resize("tl", O("#topLeftArea"), [0, 0, 1, 1], {snap: true}).on("resize", app.ui.updateScale)

        LS.Resize("aid", O("#editAid"), [1, 1, 1, 1, 1, 1, 1, 1], {
            absolute: true,
            set: false
        }).on("resize", (side, values)=>{
            for(let property in values){
                if(!values.hasOwnProperty(property)) continue;

                app.project.editingTarget.element.style[property] = (values[property] / app.container.scale) +"px"
            }
            app.ui.aidBoxUpdate()
            app.ui.editorUpdate()
        })

        app.ui.timeline.element.on('dragenter', preventDefault);
        app.ui.timeline.element.on('dragover', preventDefault);
        app.ui.timeline.element.on('drop', (evt)=>app.handleFileDrop(false, evt));
        O("#resourceLibrary").on('dragenter', preventDefault);
        O("#resourceLibrary").on('dragover', preventDefault);
        O("#resourceLibrary").on('drop', (evt)=>app.handleFileDrop(true, evt));

        O("#time_total").set(app.time.minuteFormat(app.time.total))

        let playingBefore = false;
        app.ui.timeline.handle.on("start", ()=>{
            if(app.playing){
                playingBefore = true;
                app.playing = false;
            }
        })

        app.ui.timeline.handle.on("end", ()=>{
            if(playingBefore){
                playingBefore = false;
                app.playing = true;
            }
        })

        LS.Select("color", app.ui.colorPicker, [...LS.Color.all().map(c=>{return{value: c, label: `<div ls-accent="${c}" class="select_color"></div>`}})])
            .on("change", (value)=>{
                app.project.editingTarget.color = value
            })

        app.ui.aidHandle = LS.Util.RegisterMouseDrag(O("#aidBox"), ".ls-resize-bar");

        let aidInitialX, aidInitialY, aidInitialWX, aidInitialWY;

        app.ui.aidHandle.on("start", ()=>{
            let box = O("#videoContainer").getBoundingClientRect();
            aidInitialX = M.x
            aidInitialY = M.y
            aidInitialWX = (app.project.editingTarget.x * app.container.scale) + box.left
            aidInitialWY = (app.project.editingTarget.y * app.container.scale) + box.top
        })

        app.ui.aidHandle.on("move", (x, y)=>{
            let box = O("#videoContainer").getBoundingClientRect();

            app.project.editingTarget.x = ((aidInitialWX + (x - aidInitialX)) - box.left) / app.container.scale
            app.project.editingTarget.y = ((aidInitialWY + (y - aidInitialY)) - box.top) / app.container.scale
            app.ui.aidBoxUpdate()
            app.ui.editorUpdate()
        })

        M.on("keydown", (evt)=>{

            if(['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable) return;

            let prev = app.playing;

            switch(evt.code){
                case "ControlLeft":
                    preventDefault(evt)
                    app.ui.cuttingTool = true
                break;
                case "Space":
                    preventDefault(evt)
                    app.toggle()
                break;
                case "Home":
                    preventDefault(evt)
                    app.playing = false
                    app.time.current = 0
                    app.playing = prev
                break;
                case "End":
                    preventDefault(evt)
                    app.playing = false
                    app.time.current = app.time.total
                    app.playing = prev
                break;
                case "ArrowRight":
                    preventDefault(evt)
                    app.playing = false
                    app.time.current += evt.shiftKey ? 1 : app.time.fps
                    app.playing = prev
                break;
                case "ArrowLeft":
                    preventDefault(evt)
                    app.playing = false
                    app.time.current -= evt.shiftKey ? 1 : app.time.fps
                    app.playing = prev
                break;
            }
        })

        M.on("keyup", (evt)=>{

            if(['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable) return;

            switch(evt.code){
                case "ControlLeft":
                    preventDefault(evt)
                    app.ui.cuttingTool = false
                break;
            }
        })

        app.updateZIndex()

        M.on("resize", ()=> app.ui.updateScale("resize") )
        app.ui.aidBoxUpdate();

        Q(".keyframe-timeline-item").all(element => {
            app.ui.keyframes.item(element, M.GlobalID);
        })
    }, 1)

    O("#keyframes").on("click", (event) => {
        if(event.target.tagName == "LS-TIMELINE-ROW"){
            let keyframe = N({class: "keyframe-timeline-item", style: {left: (M.x - event.target.getBoundingClientRect().left - 10) +"px"}});
            event.target.add(keyframe)
            app.ui.keyframes.item(keyframe)
        }
    })
})

document.addEventListener('fullscreenchange', () => {
    let bool = !!document.fullscreenElement;
    app.ui.isFullscreen = bool;

    Q("body, #preview").all().class("fullscreen", bool)
    if(!bool) Q("body, #preview").all().class("show-controlls", 0);
    app.ui.updateScale()
})