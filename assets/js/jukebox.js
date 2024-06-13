function Jukebox(options){
    let _this;
    return new(class Jukebox{
        constructor(options) {
            this.options=options||{};
            this.box = {};
            this.ctx = new(window.AudioContext||window.webkitAudioContext)();
            _this=this;

            this.gainNode = this.ctx.createGain()
            this.gainNode.connect(_this.ctx.destination)

            this.threads = [];
        }

        volume(value){
            // Global gain node

            if(typeof value!=="undefined") _this.gainNode.gain.value = value;
            return _this.gainNode.gain.value
        }

        Thread(sound, options = {}){
            if(!_this.box[sound])return;
            
            let gain = _this.ctx.createGain(),
                source,
                prevValues = {
                    loop: false,
                    speed: 1,
                    volume: 1,
                    ...options
                }
            ;

            gain.connect(_this.gainNode)
            gain.gain.value = prevValues.volume;

            function create(){
                source = _this.ctx.createBufferSource();
                source.buffer = _this.box[sound];
                source.connect(gain)
            }

            create();

            let thread;

            thread = {
                gain,
                get source(){
                    return source
                },
                play(offset = 0, duration = thread.duration / 1000){
                    if(source){
                        thread.destroy()
                    }
                    create()
                    source.start(0, offset, duration)
                    source.loop = prevValues.loop
                    source.playbackRate.value = prevValues.speed
                },
                resume(){
                    source.playbackRate.value = prevValues.speed
                },
                pause(){
                    thread.speed = 0
                },
                set speed(value = 1){
                    source.playbackRate.value = value
                    prevValues.speed = thread.speed
                },
                get volume(){
                    return gain.gain.value
                },
                set volume(value){
                    gain.gain.value = value;
                },
                get loop(){
                    return source.loop
                },
                set loop(enable){
                    prevValues.loop = source.loop = enable;
                },
                get speed(){
                    return source.playbackRate.value
                },
                get duration(){
                    return source.buffer.duration * 1000
                },
                stop(){
                    try{source.stop()}catch{}
                    if(source)source.disconnect()
                },
                on(...a){
                    source.addEventListener(...a)
                },
                destroy(){
                    try{source.stop()}catch{}
                    source.disconnect()
                    source = null
                    _this.threads[thread.id] = null
                }
            }

            thread.id = _this.threads.push(thread)

            return thread;
        }

        play(sound, options = {}) {
            let thread = _this.Thread(sound, options)
            if(thread){
                thread.play()
                setTimeout(thread.destroy, thread.duration)
            }
        }

        stopAll(destroy = false){
            for(const t of _this.threads){
                if(!t)continue;
                t[destroy? "destroy" : "stop"]()
            }
        }

        async get(url, name=null, callback) {
            if(!url.includes("."))url=url+".mp3";
            if(_this.options.base)url=_this.options.base+url;
            if(_this.box[name||url])return _this.box[name||url];
            try{
                let data = await _this.ctx.decodeAudioData(await(await fetch(url)).arrayBuffer());
                _this.box[name||url]=data;
                if(callback)callback(data)
                return data
            }catch(e){
                if(callback)callback(null,e)
                return e
            }
        }

        async preloadMap(map,options={}){
            let array = Array.isArray(map)
            for (let key in map) {
                let data = await _this.get((options.base?options.base:"")+map[key], array?(options.sameName?map[key]:null):key)
                if(data instanceof Error){
                    console.error(data)
                    continue
                }
            }
        }
    })(options)
}