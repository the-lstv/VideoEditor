class Presentation extends LS.EventEmitter {
    /**
     * Create a new presentation instance.
     * @param {Object} options - Configuration options for the presentation.
     * @param {number[]} options.resolution - The virtual resolution of the presentation (width, height).
     * @param {boolean} options.globalEvents - Whether to listen for global keyboard and wheel events for navigation.
     * @param {boolean} options.loop - If true, navigating past the last slide will loop back to the first slide, and vice versa.
    */
    constructor(options) {
        super();

        this.container = LS.Create(".presentation-container");
        this.viewport  = LS.Create(".presentation-viewport",        { parent: this.container });
        this.content   = LS.Create(".presentation-content.level-0", { parent: this.viewport });

        this.tabs = new LS.Tabs(this.content, { list: false, styled: false });

        this.options = LS.Util.defaults({
            resolution: [1270, 720],
            globalEvents: true,
            loop: false
        }, options);

        // Resize observer
        this.resizeObserver = new ResizeObserver(() => {
            this.applyResolution();
        });

        this.resizeObserver.observe(this.container);

        window.addEventListener("resize", () => {
            this.applyResolution();
        });

        document.addEventListener("fullscreenchange", () => {
            this.applyResolution();
        });

        this.setResolution();

        this.state = {
            initial: true,
            direction: 0,
            index: -1,
            oldIndex: -1,
            step: 0,
            newSlide: null,
            oldSlide: null
        };

        let lastIndex = -1;
        this.tabs.on("changed", (newSlideId, oldSlideId) => {
            const newSlide = this.tabs.tabs.get(newSlideId);
            const oldSlide = this.tabs.tabs.get(oldSlideId);

            const index = this.index;
            const oldIndex = lastIndex;
            const direction = lastIndex < index ? 1 : -1;
            lastIndex = index;

            this.cancelAnimations(); // Clear pending animations

            newSlide.element.style.display = "";
            newSlide.element.classList.remove("left");
            newSlide.currentStep = 0;

            for(const left of newSlide.element.querySelectorAll(".left")) {
                left.classList.remove("left");
                left.style.display = "";
            }

            const state = this.state;
            state.index = index;
            state.oldIndex = oldIndex;
            state.direction = direction;
            state.newSlide = newSlide;
            state.oldSlide = oldSlide;
            state.step = 0;

            this.quickEmit("changed", state, newSlide, oldSlide);
            this.state.initial = false;

            if(oldSlide && !oldSlide.element.classList.contains("leaving")) {
                oldSlide.element.style.display = "none";
            }
        });

        this.evh = this.handleEvent.bind(this);
        if(this.options.globalEvents) {
            window.addEventListener("keydown", this.evh);
            window.addEventListener("wheel", this.evh);
        }

        this.container.addEventListener("click", this.evh);
    }

    /**
     * Apply the current resolution and scaling to the content.
     */
    applyResolution() {
        const rect = this.container.getBoundingClientRect();

        const scale = Math.min(
            (this.options.containerWidth  || rect.width) / this.options.resolution[0],    
            (this.options.containerHeight || rect.height) / this.options.resolution[1]
        );

        this.scale = scale;
        this.content.style.transform = `translate(-50%,-50%) scale(${scale})`;
    }

    /**
     * Set the presentation resolution. This is the "virtual" resolution that your slides are designed for. The presentation will be scaled to fit the container while maintaining the aspect ratio.
     * @param {number} w - The width of the presentation resolution.
     * @param {number} h - The height of the presentation resolution.
     */
    setResolution(w, h) {
        this.options.resolution = [w || this.options.resolution[0], h || this.options.resolution[1]];
        this.content.style.width = this.options.resolution[0] + "px";
        this.content.style.height = this.options.resolution[1] + "px";
        this.applyResolution();
    }

    /**
     * Event handler for global events (keyboard, wheel, click).
     * @param {Event} event - The event object.
     */
    handleEvent(event) {
        switch(event.type) {
            case "keydown":
                switch(event.key) {
                    case "ArrowLeft":
                        this.previous();
                        break;
                    case "ArrowRight": case " ":
                        this.next();
                        break;
                    case "f":
                        this.toFullscreen();
                        break;
                }
                break;

            case "wheel":
                break;

            case "click":
                if(event.clientX < window.innerWidth / 2) {
                    this.previous();
                } else {
                    this.next();
                }
                break;

            // Add more cases as needed
        }
    }

    /**
     * Request fullscreen for the presentation container.
     */
    toFullscreen() {
        const fsTarget = this.container;
        if (fsTarget.requestFullscreen) {
            fsTarget.requestFullscreen();
        } else if (fsTarget.mozRequestFullScreen) { /* Firefox */
            fsTarget.mozRequestFullScreen();
        } else if (fsTarget.webkitRequestFullscreen) { /* Chrome, Safari & Opera */
            fsTarget.webkitRequestFullscreen();
        } else if (fsTarget.msRequestFullscreen) { /* IE/Edge */
            fsTarget.msRequestFullscreen();
        }
    }

    /**
     * Add a new slide to the presentation.
     * @param {HTMLElement} container - The container element for the slide.
     */
    add(container) {
        const id = container.id || "slide-" + this.tabs.tabs.size + LS.Misc.uid();
        this.tabs.add(id, container);

        container.style.display = "none";

        if(this.tabs.index === -1) {
            this.set(0);
        }
    }

    /**
     * Go to a specific slide.
     * @param {string|number} id - The ID or index of the slide to go to.
     */
    set(id) {
        this.tabs.set(id);
    }

    /**
     * Go to the next slide, or advance steps.
     */
    next(skipSteps = false) {
        if(!skipSteps) {
            const currentSlide = this.getSlide(this.index);

            if(currentSlide && currentSlide.steps && currentSlide.currentStep < currentSlide.steps) {
                currentSlide.currentStep++;
                this.state.step = currentSlide.currentStep;
                this.quickEmit("step", this.state);
                return;
            }
        }

        this.tabs.next(this.options.loop);
    }

    /**
     * Go to the previous slide, or go back steps.
     */
    previous() {
        this.tabs.previous(this.options.loop);
    }

    /**
     * Sorts the slides based on the provided compare function.
     * @param {Function} compareFunction - The function used to determine the order of the slides.
    */
    sort(compareFunction) {
        this.tabs.order.sort(compareFunction);
    }

    get index() {
        return this.tabs.index;
    }

    #animations = [];

    /**
     * Helper for animations.
     * @param {string|HTMLElement|HTMLElement[]} target - The target element(s) or selector to animate.
     * @param {Keyframe[]} keyframes - Keyframes for the animation.
     * @param {Object} options - Options for the animation (duration, easing, etc.).
    */
    animate(target, keyframes, options) {
        if(!target) return;

        if(typeof target === "string" || Array.isArray(target)) {
            const array = Array.isArray(target)? target: presentation.tabs.currentElement()?.querySelectorAll(target);
            if(array && array.length) {
                let i = 0;
                for(let foundTarget of array) {
                    const newOptions = Object.assign({}, options);
                    if(newOptions.staggering) {
                        newOptions.delay = (newOptions.delay || 0) + (newOptions.staggering * i);
                        delete newOptions.staggering;
                    }
                    this.animate(foundTarget, keyframes, newOptions);
                    i++;
                }
            }
            return;
        }

        const animation = target.animate(keyframes, options);
        this.#animations.push(animation);
        return animation;
    }

    /**
     * Helper for leaving animations (hide element on end).
     * @param {string|HTMLElement|HTMLElement[]} target - The target element(s) or selector to animate.
     * @param {Keyframe[]} keyframes - Keyframes for the animation.
     * @param {Object} options - Options for the animation (duration, easing, etc.).
    */
    leaving(target, keyframes, options) {
        const animation = this.animate(target, keyframes, options);
        animation.effect.target.classList.add("leaving");
        animation.isLeaving = true;

        animation.onfinish = () => {
            if(this.#animations.includes(animation)) {
                // this.animations.splice(this.animations.indexOf(animation), 1);
                animation.effect.target.style.display = "none";
                animation.effect.target.classList.add("left");
                animation.effect.target.classList.remove("leaving");
            }
        };
    }

    /**
     * Cancel all ongoing animations and clear the animation queue.
     */
    cancelAnimations() {
        for(const animation of this.#animations) {
            if(animation.isLeaving) {
                animation.effect.target.style.display = "none";
                animation.effect.target.classList.add("left");
                animation.effect.target.classList.remove("leaving");
            }

            animation.cancel();
        }

        this.#animations.length = 0;
    }
    /**
     * Helper for transitions between two elements.
     * @param {string|HTMLElement} newTarget - The new target element or selector to transition in.
     * @param {string|HTMLElement} oldTarget - The old target element or selector to transition out.
     * @param {Object} keyframes - An object containing 'in' and 'out' keyframe arrays for the new and old targets, respectively.
     * @param {Object} options - Options for the animations (duration, easing, etc.).
     */
    transition(newTarget, oldTarget, keyframes, options) {
        if(oldTarget) {
            this.leaving(oldTarget, keyframes.out, options.out? options.out: options);
        }

        if(newTarget) {
            this.animate(newTarget, keyframes.in, options.in? options.in: options);
        }
    }

    /**
     * Helper to split the text content of an element into individual spans for each letter.
     * @param {HTMLElement} target - The target element whose text content will be split.
     * @param {string} [className=""] - Optional class name to add to each letter span.
     */
    static splitLetters(target, className = "") {
        const letters = target.textContent.split("");
        target.textContent = "";
        for(const letter of letters) {
            const span = document.createElement("span");
            span.textContent = letter;
            if(className) {
                span.classList.add(className);
            }
            target.appendChild(span);
        }
    }

    /**
     * Set steps for a slide, allowing you to reveal content in stages.
     * @param {object} slide - The slide object to set steps for.
     * @param {number} stepCount - The total number of steps for the slide.
     */
    setSteps(slide, stepCount) {
        slide.steps = stepCount;
        slide.currentStep = 0;
    }

    getSlide(index) {
        return this.tabs.tabs.get(this.tabs.order[index]);
    }

    getSlideById(id) {
        return this.tabs.tabs.get(id);
    }

    /**
     * Find the slide object associated with a given element.
     * Warning: This is not an efficient way to find a slide; inside slides, use getSlide or getSlideById (which are both O(1)) whenever possible.
     * @param {HTMLElement} element - The element to find the associated slide for.
     */
    findSlideFromElement(element) {
        return this.tabs.tabs.values().find(v => v.element === element);
    }

    destroy() {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;

        this.cancelAnimations();

        this.tabs.destroy();
        this.tabs = null;
        this.destroyed = true;

        window.removeEventListener("keydown", this.evh);
        window.removeEventListener("wheel",   this.evh);

        this.container.removeEventListener("click", this.evh);
        this.container.remove();
        this.container = null;

        // TODO: destroy event handlers & stuff
    }

    // Static spring easing function (generate your own if you want dynamic physics)
    static SPRING = 'linear(0, 0.0018, 0.007 1.17%, 0.0334, 0.0758, 0.1306 5.54%, 0.2505 8.16%, 0.6477 16.03%, 0.7622 18.65%, 0.8498, 0.9229 23.32%, 0.9878 25.94%, 1.0308 28.27%, 1.0643 30.9%, 1.0791, 1.0886 34.39%, 1.094, 1.0944 38.48%, 1.0903 40.81%, 1.0814 43.43%, 1.0362 53.05%, 1.0184 57.42%, 1.0059, 0.9976 65.58%, 0.9925 70.25%, 0.991 75.79%, 0.9996 99.98%)';

    // Simple transition presets
    static TRANSITIONS = {
        fade: {
            in: [
                { opacity: 0 },
                { opacity: 1 }
            ],
            out: [
                { opacity: 1 },
                { opacity: 0 }
            ]
        },

        scale: {
            in: [
                { opacity: 0, transform: "scale(0.95)" },
                { opacity: 1, transform: "scale(1)" }
            ],
            out: [
                { opacity: 1, transform: "scale(1)" },
                { opacity: 0, transform: "scale(0.95)" }
            ]
        },

        slideLeft: {
            in: [
                { opacity: 0, transform: "translateX(20px)" },
                { opacity: 1, transform: "translateX(0)" }
            ],
            out: [
                { opacity: 1, transform: "translateX(0)" },
                { opacity: 0, transform: "translateX(-20px)" }
            ]
        },

        slideRight: {
            in: [
                { opacity: 0, transform: "translateX(-20px)" },
                { opacity: 1, transform: "translateX(0)" }
            ],
            out: [
                { opacity: 1, transform: "translateX(0)" },
                { opacity: 0, transform: "translateX(20px)" }
            ]
        },
    };
}

window.Presentation = Presentation;

export default Presentation;