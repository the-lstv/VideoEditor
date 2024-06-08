let globalWindowTopIndex = 100, windowList = [];

function createWindow(options = {}, content = []){
    let tools, id;

    let handleHeight = 35;

    options = LS.Util.defaults({
        width: 300,
        height: 460,
        minWidth: 200,
        maxWidth: 1000,
        minHeight: 0,
        maxHeight: 1000,
        resizeable: true,
        maximizeable: true,
        minimizeable: true,
        closeable: true,
        handle: true,
    }, options)

    let _window = N({
        class: "window-container",
        style: {
            width: (options.width) + "px",
            height: (+ options.height + handleHeight) + "px",
            minWidth: (options.minWidth) + "px",
            maxWidth: (options.maxWidth) + "px",
            minHeight: (options.minHeight + handleHeight) + "px",
            maxHeight: (options.maxHeight - handleHeight) + "px",
        },
        inner: N({
            class: "window" + (options.tags? " " + options.tags.join(" ") : ""),
            inner: [
                options.handle? N({class: "window-handle", inner: [
                    N("span", {
                        innerText: options.title,
                        class: "window-title"
                    }),
                    N({
                        class: "window-buttons",
                        inner:[
                            options.minimizeable? N("button", {accent: "auto", class: "elevated circle", inner: "<i class=bi-dash-lg></i>", onclick() {tools.minimize()}}) : "",
                            options.maximizeable? N("button", {accent: "auto", class: "elevated circle", inner: "<i class=bi-square></i>", onclick() {tools.maximizeToggle()}}) : "",
                            options.closeable? N("button", {accent: "red", class: "elevated circle", inner: "<i class=bi-x-lg></i>", onclick() {tools.close()}}) : "",
                        ]
                    })
                ]}): "",
                N({class: "window-content", inner: content}),
            ]
        })
    });

    if(options.resizeable) LS.Resize(_window, [1, 1, 1, 1, 1, 1, 1, 1], {
        absolute: true
    }).on("resize", (direction, properties) => {
        if(options.onResize) options.onResize(direction, properties)
    })

    // dragdrop.enableDrag(_window, _window.get(".window-handle"))

    let handle;
    
    if(options.handle) handle = LS.Util.RegisterMouseDrag(_window.get(".window-handle"), ".window-buttons *", {
        buttons: [0],
        cursor: "grabbing"
    })

    if(options.handle) _window.get(".window-handle").on("dblclick", () => {
        tools.maximizeToggle()
    })


    let initialX = M.x,
        initialY = M.y,
        initialBound
    ;

    function onMoveStart(){
        initialX = M.x
        initialY = M.y
        initialBound = _window.getBoundingClientRect()

        if(options.onMoveStart) options.onMoveStart()
    }

    if(options.handle) handle.on("start", onMoveStart)

    if(options.handle) handle.on("move", () => {
        if(tools.maximized) {
            tools.maximized = false
            _window.style.top = (M.y - (M.y / 2)) + "px"
            _window.style.left = (M.x - (M.x / 2)) + "px"
            initialBound = _window.getBoundingClientRect();
        }
        
        let currentBound = _window.getBoundingClientRect();

        let newX = Math.max((currentBound.width * -1) + 65, Math.min(innerWidth - 65, (M.x - (initialX - initialBound.left)))),
            newY = Math.max(0, Math.min(innerHeight - 200, (M.y - (initialY - initialBound.top))))
        ;

        _window.style.left = newX + "px"
        _window.style.top = newY + "px"

        if(options.onMove) options.onMove()
    })

    if(options.handle) handle.on("end", () => {
        if(options.onMoveEnd) options.onMoveEnd()
    })

    _window.on("mousedown", "touchstart", ()=>{
        tools.focus()
    })

    let previousState;
    
    tools = {
        element: _window,

        options,

        gid: M.GlobalID,

        focus(){
            globalWindowTopIndex++
            _window.style.zIndex = globalWindowTopIndex

            Q(".window-container.focused").all().class("focused", 0)
            _window.class("focused")
            if(options.onFocus) options.onFocus()
        },

        close(){
            let prevent;
            if(options.onClosed) options.onClosed({
                prevent(){
                    prevent = true
                }
            })

            if(prevent) return;

            _window.remove()
            delete windowList[id]
        },

        minimize(){
            LS.Toast.show("Got nowhere to minimize the window to (yet)", {
                accent: "red",
                timeout: 3000
            })
        },

        _maximized: false,

        get maximized(){
            return tools._maximized
        },

        set maximized(boolean){
            boolean = !!boolean
            tools._maximized = boolean

            _window.class("maximized", boolean)

            if(boolean){
                previousState = _window.getBoundingClientRect();

                _window.applyStyle({
                    top: 0 + "px",
                    left: 0 + "px",
                    width: "100%",
                    height: "100%",
                    minWidth: "unset",
                    maxWidth: "unset",
                    minHeight:"unset",
                    maxHeight:"unset",
                })
            } else {
                _window.applyStyle({
                    top: previousState.top + "px",
                    left: previousState.left + "px",
                    height: previousState.width + "px",
                    width: previousState.height + "px",
                    minWidth: (options.minWidth) + "px",
                    maxWidth: (options.maxWidth) + "px",
                    minHeight: (options.minHeight + handleHeight) + "px",
                    maxHeight: (options.maxHeight - handleHeight) + "px",
                })
            }
        },

        maximize(){
            tools.maximized = true;
        },

        maximizeToggle(){
            tools.maximized = !tools.maximized;
        },

        addToWorkspace(){
            O("#windowContainer").add(_window)
            tools.focus()
        }
    }

    id = windowList.push(tools) - 1

    return tools
}