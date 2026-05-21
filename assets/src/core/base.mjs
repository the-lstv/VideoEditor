/**
 * Basic helper classes.
 * @copyright 2026 lstv.space
 * @license GPL-3.0
 */

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

        const icon = ((target instanceof LS.Multipane.Slot)? "bi-columns-gap": target.icon || "bi-puzzle");
        const title = ((target instanceof LS.Multipane.Slot)? target.__titleElement.innerText: (target.title || target.name || target.label || target.__name || target.constructor.name));

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


export {
    Command,
    HistoryManager,
    dragState
};