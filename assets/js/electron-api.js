if(isNode) (() => {
    // TODO: Make major changes
    const { ipcRenderer } = require('electron');

    class EventContext {
        constructor(name) {
            this.name = name;
        }

        eventContext(name){
            return new EventContext(this.name + ":" + name);
        }

        emit(event, ...args){
            return ipcRenderer.send(this.name + ":" + event, ...args);
        }

        invoke(event, ...args){
            return ipcRenderer.invoke(this.name + ":" + event, ...args);
        }

        on(event, callback){
            return ipcRenderer.on(this.name + ":" + event, callback)
        }

        toggleDevTools(){
            return this.emit("toggle-devtools");
        }
    }

    class ArcContext extends EventContext {
        constructor(){
            super("arc");
        }

        toggleDevTools(){
            return arc.emit("window:toggle-devtools");
        }

        /**
         * @experimental
         */
        async getWallpaper() {
            const wallpaper = await ipcRenderer.invoke('arc:get-wallpaper');
            return wallpaper;
        }

        /**
         * @experimental
         */
        async enableAcrylicWindow(){
            if (document.readyState !== 'complete') {
                await arc.waitForDocumentReady;
            }

            const wrapperElement = document.getElementById('wrapper');
            if(!wrapperElement) throw new Error('Cant enable acrylic window, #wrapper element not found');

            const wallpaper = await arc.getWallpaper();

            wrapperElement.style.backgroundImage = `url(${wallpaper})`;
            wrapperElement.classList.add('acrylic');

            ipcRenderer.on('arc:window-move', (event, x, y) => {
                wrapperElement.style.backgroundPosition = `${-(x - screen.availLeft)}px ${-(y - screen.availTop)}px`;
                wrapperElement.style.backgroundSize = `${screen.width}px ${screen.height}px`;
            });

            ipcRenderer.invoke('arc:get-position');
        }

        /**
         * @experimental
         */
        async enableDynamicColor(){
            const wallpaper = await arc.getWallpaper();

            const img = new Image();
            img.src = wallpaper;

            img.onload = function(){
                const color = LS.Color.fromImage(img);
        
                LS.Color.update("dynamic", color);
                LS.Color.setAccent("dynamic");
            }
        }

        registerShortcut(shortcut, callback = null){
            if(callback){
                ipcRenderer.on("arc:handle-shortcut", (event, sentShortcut) => {
                    if(sentShortcut === shortcut) callback();
                });
            }

            arc.emit("register-shortcut", shortcut);
        }
    }

    const arc = {
        name: "arc",

        waitForDocumentReady: new Promise(resolve => window.addEventListener('load', resolve)),

        window: new class ArcWindow extends EventContext {
            constructor(){
                super("arc:window");
            }

            hide(){
                this.emit("hide");
            }

            show(){
                this.emit("show");
            }

            focus(){
                this.emit("focus");
            }

            blur(){
                this.emit("blur");
            }

            close(){
                this.emit("close");
            }

            minimize(){
                this.emit("minimize");
            }

            maximize(){
                this.emit("maximize");
            }

            unmaximize(){
                this.emit("unmaximize");
            }

            maximizeToggle(){
                this.emit("maximize-toggle");
            }

            toggle(){
                this.emit("toggle");
            }

            resize(width, height){
                this.emit("resize", width, height);
            }

            move(x, y){
                this.emit("move", x || 0, y || 0);
            }

            moveBy(x, y){
                this.emit("move-by", x || 0, y || 0);
            }

            getPosition(){
                return this.invoke("get-position");
            }

            setIgnoreMouseEvents(boolean = true){
                this.emit("set-ignore-mouse-events", !!boolean);
            }

            setAlwaysOnTop(boolean = true, type){
                this.emit("set-always-on-top", !!boolean, type);
            }
        }
    }

    arc.window.__proto__.makeClickThrough = arc.window.__proto__.setIgnoreMouseEvents;

    Object.setPrototypeOf(arc, ArcContext.prototype);

    // arc.enableDynamicColor()
    // arc.enableAcrylicWindow()

    if (typeof module !== "undefined" && module.exports) {
        module.exports = arc;
    }

    if (typeof window !== "undefined") {
        window.arc = arc;
    }
})();