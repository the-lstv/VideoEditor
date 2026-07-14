import AcceleratedTextGridRenderer from "../graphics/text-engine.mjs";
// import StringView from "../../utils/StringView.mjs";

const EMPTY_U8 = new Uint8Array(0);

/**
 * Mutable binary text field with undo/redo & line scanning.
 * Used to work with large editable documents
 */

class MutableTextField {
    constructor(data, commitCallback = null) {
        this.load(data);
        this.commitCallback = commitCallback;
    }

    commit() {
        this.data = this.getData();
        this.appendBuffer = new Uint8Array(1024);
        this.appendBufferUsed = 0;
        this.pieces = [[0, this.data.length, 0]];
        if(this.commitCallback) {
            this.commitCallback(this);
        }
    }

    reset() {
        this.data = EMPTY_U8;
        this.lines = null;
        this.lineCount = 0;
        this.appendBuffer = new Uint8Array(1024);
        this.appendBufferUsed = 0;
        this.pieces = [[0, 0, 0]]; // Empty document
        if(this.commitCallback) {
            this.commitCallback(this);
        }
        return this;
    }

    load(text) {
        if(!text || text.length === 0) {
            return this.reset();
        }

        if(text instanceof Uint8Array) {
            this.data = text;
        } else if(typeof text === "string") {
            if(text.length > 1e4) {
                console.warn("Prefer passing input as a buffer.");
            }

            this.data = this.__s2u8(text);
        } else {
            throw new Error("Invalid text type, must be Uint8Array or string");
        }

        this.pieces = [[0, this.data.length, 0]];
        this.appendBuffer = new Uint8Array(1024);
        this.appendBufferUsed = 0;

        // Rough estimate for now, assuming average line length of 50 chars + 512 lines of buffer for growth
        this.lines = new Uint32Array((Math.ceil(this.data.length / 50) + 512) * 2);
        this.lineCount = 0;
        this.scanLines();

        if(this.commitCallback) {
            this.commitCallback(this);
        }
        return this;
    }

    getOriginalData() {
        return this.data;
    }

    getData() {
        if (!this.pieces || this.pieces.length === 0 || (this.pieces.length === 1 && this.pieces[0][1] === 0)) return EMPTY_U8;

        if(this.pieces.length === 1 && this.pieces[0][2] === 0) {
            // If the document is a single piece referencing the original buffer, return it directly without copying
            return this.data.subarray(this.pieces[0][0], this.pieces[0][0] + this.pieces[0][1]);
        }

        const result = new Uint8Array(this.pieces.reduce((sum, piece) => sum + piece[1], 0));
        let offset = 0;
        for (const [pBufOffset, pLen, pBufIdx] of this.pieces) {
            if (pBufIdx === this.APPEND_BUFFER_INDEX) {
                result.set(this.appendBuffer.subarray(pBufOffset, pBufOffset + pLen), offset);
            } else {
                result.set(this.data.subarray(pBufOffset, pBufOffset + pLen), offset);
            }
            offset += pLen;
        }
        return result;
    }

    getText() {
        return textDecoder.decode(this.getData());
    }

    ensure(capacity) {
        if(this.appendBuffer.length - this.appendBufferUsed >= capacity) return;

        let newSize = this.appendBuffer.length;
        while(newSize - this.appendBufferUsed < capacity) {
            newSize *= 2;
        }

        const newBuffer = new Uint8Array(newSize);
        newBuffer.set(this.appendBuffer.subarray(0, this.appendBufferUsed));
        this.appendBuffer = newBuffer;
    }

    /**
     * Insert & overwrite
     * @param {string|Uint8Array} text - Text to insert (string will be UTF-8 encoded)
     * @param {number} at - Byte offset to insert at
     * @param {boolean} shift - If true, the new text will be inserted and push existing text forward. If false, the new text will overwrite existing text.
     */
    insert(text, at, shift = false) {
        if (!text) return;
        const encoded = text instanceof Uint8Array ? text : this.__s2u8(text);
        if (encoded.length === 0) return;

        // Delete the equivalent length first
        if (!shift) {
            this.delete(at, encoded.length);
        }

        // Allocate space in the appendBuffer
        this.ensure(encoded.length);
        const startOffset = this.appendBufferUsed;
        this.appendBuffer.set(encoded, startOffset);
        this.appendBufferUsed += encoded.length;

        // Handle empty document
        if (!this.pieces || this.pieces.length === 0) {
            this.pieces = [[startOffset, encoded.length, this.APPEND_BUFFER_INDEX]];
            return;
        }

        const [index, offset] = this.#findPieceOffset(at);

        // Clamped to end of document
        if (index >= this.pieces.length) {
            const lastPiece = this.pieces[this.pieces.length - 1];
            // Extend the last piece if contiguous in the append buffer
            if (lastPiece[2] === this.APPEND_BUFFER_INDEX && lastPiece[0] + lastPiece[1] === startOffset) {
                lastPiece[1] += encoded.length;
            } else {
                this.pieces.push([startOffset, encoded.length, this.APPEND_BUFFER_INDEX]);
            }
            return;
        }

        const piece = this.pieces[index];
        const [pBufOffset, pLen, pBufIdx] = piece;

        if (offset === 0) {
            // Inserting perfectly before the current piece
            let merged = false;
            if (index > 0) {
                const prevPiece = this.pieces[index - 1];
                // Extend the previous piece if contiguous
                if (prevPiece[2] === this.APPEND_BUFFER_INDEX && prevPiece[0] + prevPiece[1] === startOffset) {
                    prevPiece[1] += encoded.length;
                    merged = true;
                }
            }
            if (!merged) {
                this.pieces.splice(index, 0, [startOffset, encoded.length, this.APPEND_BUFFER_INDEX]);
            }
        } else if (offset === pLen) {
            // Inserting perfectly after the current piece
            // Extend the current piece if contiguous
            if (pBufIdx === this.APPEND_BUFFER_INDEX && pBufOffset + pLen === startOffset) {
                piece[1] += encoded.length;
            } else {
                this.pieces.splice(index + 1, 0, [startOffset, encoded.length, this.APPEND_BUFFER_INDEX]);
            }
        } else {
            // Split the current piece and inject the new piece in the middle
            const leftPiece = [pBufOffset, offset, pBufIdx];
            const newPiece = [startOffset, encoded.length, this.APPEND_BUFFER_INDEX];
            const rightPiece = [pBufOffset + offset, pLen - offset, pBufIdx];

            // Check if the left split chunk can contiguous-merge
            if (leftPiece[2] === this.APPEND_BUFFER_INDEX && leftPiece[0] + leftPiece[1] === startOffset) {
                leftPiece[1] += encoded.length;
                this.pieces.splice(index, 1, leftPiece, rightPiece);
            } else {
                this.pieces.splice(index, 1, leftPiece, newPiece, rightPiece);
            }
        }
    }

    /**
     * Delete
     * @param {number} at - Byte offset to delete at
     * @param {number} length - Number of bytes to delete
     */
    delete(at, length) {
        if (length <= 0 || !this.pieces || this.pieces.length === 0) return;

        let [index, offset] = this.#findPieceOffset(at);
        let remaining = length;

        while (remaining > 0 && index < this.pieces.length) {
            const piece = this.pieces[index];
            const [pBufOffset, pLen, pBufIdx] = piece;
            const availableInPiece = pLen - offset;

            if (availableInPiece > remaining) {
                // The removal sits entirely within this single piece
                if (offset === 0) {
                    // Shave off the start of the piece
                    piece[0] += remaining;
                    piece[1] -= remaining;
                } else {
                    // Split the piece and discard the middle gap
                    const leftPiece = [pBufOffset, offset, pBufIdx];
                    const rightPiece = [pBufOffset + offset + remaining, pLen - offset - remaining, pBufIdx];
                    this.pieces.splice(index, 1, leftPiece, rightPiece);
                }
                remaining = 0; 
            } else {
                // The removal swallows the end of this piece, and spills into the next
                if (offset === 0) {
                    // Remove the piece entirely
                    this.pieces.splice(index, 1);
                    // Do not increment index because the next piece shifted to current `index`
                    index--; 
                } else {
                    // Shave off the end of this piece
                    piece[1] = offset; 
                }
                
                remaining -= availableInPiece;
                index++;
                offset = 0; // Future pieces in the while loop will be deleted starting at offset 0
            }
        }
    }

    #findPieceOffset(at) {
        let currentOffset = 0;
        for (let i = 0; i < this.pieces.length; i++) {
            const len = this.pieces[i][1];
            if (currentOffset + len > at) {
                return [i, at - currentOffset];
            }
            currentOffset += len;
        }
        
        // If 'at' is out of bounds (or exactly at the end of the file),
        // gracefully clamp it to the final character of the last piece.
        if (this.pieces.length > 0) {
            const lastIdx = this.pieces.length - 1;
            return [lastIdx, this.pieces[lastIdx][1]];
        }
        
        return [0, 0];
    }

    findPiece(at) {
        // Binary search for the piece containing the given offset
        let left = 0;
        let right = this.pieces.length - 1;
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const pieceStart = this.pieces[mid][0];
            const pieceEnd = pieceStart + this.pieces[mid][1];

            if(at >= pieceStart && at < pieceEnd) {
                return this.pieces[mid];
            } else if(at < pieceStart) {
                right = mid - 1;
            } else {
                left = mid + 1;
            }
        }
        throw new Error("Piece not found");
    }

    __s2u8(str) {
        const len = str.length;

        if(len === 0) return EMPTY_U8;
        if(len === 1) return new Uint8Array([str.charCodeAt(0)]);

        // A loop is faster under ~2000 chars.
        // After that the encoder overhead catches up to JS loop overhead and becomes faster
        // Warning: this loop only handles ASCII, utf8 should be supported eventually
        // Not yet because the renderer itself currently only handles ASCII
        if(len <= 2000) {
            const buf = new Uint8Array(len);
            for(let i = 0; i < len; i++) {
                buf[i] = str.charCodeAt(i);
            }
            return buf;
        }

        return textEncoder.encode(str);
    }

    /**
     * Scan line offsets in the document
     * TODO: Scan in ranges & if lexing, this could be handled by the lexer itself anyway to reduce passes (maybe)
     */
    scanLines() {
        // For now we scan the whole document
        // Later only scan by ranges to avoid iterating the whole document if not needed
        const data = this.data;
        const lines = this.lines;

        const len = data.length;
        let i = 0;
        let line = 0;

        // Unrolling is ~2x faster on Firefox, small or even slightly negative change on Chrome.
        // I will keep unrolling for Firefox and chrome will have to suck it

        for (; i <= len - 8; i += 8) {
            if (data[i    ] === 10) { lines[line++] = i     + 1; }
            if (data[i + 1] === 10) { lines[line++] = i + 1 + 1; }
            if (data[i + 2] === 10) { lines[line++] = i + 2 + 1; }
            if (data[i + 3] === 10) { lines[line++] = i + 3 + 1; }
            if (data[i + 4] === 10) { lines[line++] = i + 4 + 1; }
            if (data[i + 5] === 10) { lines[line++] = i + 5 + 1; }
            if (data[i + 6] === 10) { lines[line++] = i + 6 + 1; }
            if (data[i + 7] === 10) { lines[line++] = i + 7 + 1; }
        }

        // tail
        for (; i < len; i++) {
            if (data[i] === 10) lines[line++] = i + 1;
        }

        this.lineCount = line + 1;
    }

    destroy() {
        if(this.destroyed) return;
        this.data = null;
        this.lines = null;
        this.appendBuffer = null;
        this.pieces = null;
        this.appendBufferUsed = null;
        this.destroyed = true;
    }
}

class EditorState extends MutableTextField {
    constructor(a, b, c) {
        super(a, b, c);

        this.caretCol = 0;
        this.caretRow = 0;

        this.selectionCache = null;

        this.tokens = [];
    }

    destroy() {
        if(this.destroyed) return;
        this.caretCol = null;
        this.caretRow = null;
        this.selectionCache = null;
        this.tokens = null;
        super.destroy();
    }
}

/**
 * A high-performance, hardware-accelerated text/code editor!
 * Can handle virtually any amount of text seamlessly, and doesn't use DOM for text rendering.
 */
class CodeEditor extends AcceleratedTextGridRenderer {
    constructor(options = {}) {
        // Number of extra rows/columns to render beyond the viewport for smooth scrolling.
        // Large values will slow down rendering and may cause lagging, but small values make scrolling less efficient, so the best value is in a balance.
        options.virtualScrollBuffer = 32;
        options.virtualScrolling = true;

        super(options);

        // -- Setup container
        this.container.style.cursor = "text";
        this.container.tabIndex = 0;
        this.container.classList.add("ls-code-editor");
        this.container.style = "position: relative";

        // -- Theme
        this.theme = null;
        this.setTheme();

        // -- Other setup
        this.frameFunction = this.#renderEditorFrame.bind(this);
        this.onVirtualScroll = this.#renderSeek.bind(this);

        // -- Editor state
        this.state = options.state || new EditorState(options.content || null, this.#renderScreen.bind(this));

        if(!(this.state instanceof EditorState)) {
            throw new Error("State must be an instance of EditorState");
        }

        this.decorationLayer = LS.Create({
            inner: "Test",
            className: "ls-editor-decoration-layer",
            style: "position: absolute; top: 0; left: 0; pointer-events: none;"
        }).addTo(this.container);

        this.on("scroll", (scrollX, scrollY) => {
            this.decorationLayer.style.transform = `translate(${-scrollX}px, ${-scrollY}px)`;
        });

        this.on("resize", (scrollX, scrollY) => {
            this.syncDecorationLayer();
        });
    }

    syncDecorationLayer() {
        this.decorationLayer.style.width = `${this.cols * this.cellWidth}px`;
        this.decorationLayer.style.height = `${this.rows * this.cellHeight}px`;
        this.decorationLayer.style.fontSize = `${this.fontSize}px`;
        this.decorationLayer.style.lineHeight = this.lineHeight;
    }

    setTheme(theme = null) {
        // Used for color conversion
        const tempColor = new LS.Color();

        this.theme = {
            default: tempColor.set(theme && theme.default || "#aaaaaa").pixel,
            identifier: tempColor.set(theme && theme.identifier || "#a8bbdb").pixel,
            keyword: tempColor.set(theme && theme.keyword || "#ff4488").pixel,
            string: tempColor.set(theme && theme.string || "#44ff44").pixel,
            number: tempColor.set(theme && theme.number || "#ff8844").pixel,
            number_unit: tempColor.set(theme && (theme.number_unit || theme.number) || "#b66231").pixel,
            braces: tempColor.set(theme && theme.braces || "#ababab").pixel,
            operator: tempColor.set(theme && theme.operator || "#8888ff").pixel,
            background: tempColor.set(theme && theme.background || "#000000").pixel,
            selection: tempColor.set(theme && theme.selection || "#ffffff88").pixel,
            comment: tempColor.set(theme && theme.comment || "#4b4b4b").pixel
        };

        // Map to Glitter tokens (temporary)
        this.theme.tokens = [];
        this.theme.tokens[Glitter.lang.TOKEN_KEYWORD] = this.theme.keyword;
        this.theme.tokens[Glitter.lang.TOKEN_DECLARATION] = this.theme.keyword;
        this.theme.tokens[Glitter.lang.TOKEN_IDENTIFIER] = this.theme.identifier;
        this.theme.tokens[Glitter.lang.TOKEN_STRING] = this.theme.string;
        this.theme.tokens[Glitter.lang.TOKEN_NUMBER] = this.theme.number;
        this.theme.tokens[Glitter.lang.TOKEN_UNIT] = this.theme.number_unit || this.theme.number;
        this.theme.tokens[Glitter.lang.TOKEN_OPERATOR] = this.theme.operator;
        this.theme.tokens[Glitter.lang.TOKEN_CLOSING_BRACE] = this.theme.tokens[Glitter.lang.TOKEN_OPENING_BRACE] = this.theme.braces;
        this.theme.tokens[Glitter.lang.TOKEN_COMMENT] = this.theme.comment;

        this.setOptions({ backgroundColor: this.theme.background });
        this.render();
    }

    setFromVSCodeTheme(theme) {
        this.setTheme(CodeEditor.fromVSCodeTheme(theme));
    }

    async init(options = {}) {
        const promise = super.init(options);
        await promise;
        this.syncDecorationLayer();
        this.#renderScreen(this.state);
    }

    switchState(newState) {}

    setText(text) {
        this.state.load(text);

        // TEMPORARY
        // Later we should stream tokenization
        this.tokens = Glitter.tokenize(this.state.getData(), { writeTokenValues: false, asLineMap: true });
    }
    
    getText() {
        return this.state.getText();
    }

    // Here things like decorations will go later
    #renderEditorFrame() {}

    /**
     * @param {EditorState} state
     */
    #renderScreen(state, virtual = false) {
        if(!state || !state.lines || state !== this.state) return;

        // Render visible lines
        for (let row = 0; row < this.rows; row++) {
            const lineIndex = this.virtualRow + row;
            if(lineIndex >= state.lineCount) {
                this.clearLine(row);
                continue;
            }

            const lineStart = state.lines[lineIndex - 1] || 0;
            const lineLength = (state.lines[lineIndex] || state.data.length) - lineStart;
            const textColor = this.theme.default;
            const tokenColors = this.theme.tokens;
            const data = state.data;

            /**
             * @type {Array<[type, start, end]>}
             */
            const lineTokens = this.tokens[lineIndex];
            let col = 0;

            // Draw highlight tokens if any
            if (lineTokens && lineTokens.length > 0) {
                for (const token of lineTokens) {
                    for (; col < this.cols && col < lineLength && col < (token[2] - lineStart); col++) {
                        const charCode = data[lineStart + col] || 32;
                        let color = tokenColors[token[0]] || textColor;
                        this._updateVertex(col, row, charCode, color[0], color[1], color[2], color[3]);
                    }
                }
            }

            // Draw remaining text & fill rest of line with spaces
            for (; col < this.cols; col++) {
                const char = col < lineLength ? data[lineStart + col] : 32;
                this._updateVertex(col, row, char, textColor[0], textColor[1], textColor[2], textColor[3]);
            }
        }

        this.render();
    }

    // TODO: Virtual scrolling without re-rendering the screen
    #renderSeek(col, row) {
        // console.log("Virtual scroll to", col, row);
        this.#renderScreen(this.state, true);
    }

    /**
     * Set theme from a VSCode theme object.
     * TODO: The token color mapping is currently very rough and may not be 100% accurate.
     * @param {*} theme
     */
    static fromVSCodeTheme(theme) {
        const colors = theme.colors || {};
        const tokenColors = theme.tokenColors || theme.settings || [];

        const getTokenColor = (scopes) => {
            for (const rule of tokenColors) {
                if (!rule.scope || !rule.settings?.foreground) continue;

                const ruleScopes = Array.isArray(rule.scope)? rule.scope: rule.scope.split(",").map((s) => s.trim());

                for (const s of scopes) {
                    if (ruleScopes.some((r) => r === s || r.startsWith(s + ".") || s.startsWith(r + "."))) {
                        return rule.settings.foreground;
                    }
                }
            }
            return undefined;
        };

        return {
            default: colors["editor.foreground"] || getTokenColor(["source", "text"]),
            identifier: getTokenColor([
                "variable",
                "variable.other",
                "variable.parameter",
                "entity.name.variable",
            ]),
            keyword: getTokenColor(["keyword", "storage", "storage.type", "storage.modifier"]),
            string: getTokenColor(["string", "constant.character"]),
            number: getTokenColor(["constant.numeric"]),
            number_unit:
                getTokenColor([
                    "constant.numeric.unit",
                    "constant.other.unit",
                    "keyword.other.unit",
                ]) || getTokenColor(["constant.numeric"]),
            braces: getTokenColor([
                "punctuation.section.braces",
                "punctuation.section.brackets",
                "punctuation.section.parens",
                "meta.brace",
            ]),
            operator: getTokenColor([
                "keyword.operator",
                "punctuation.separator",
                "punctuation.accessor",
                "operator",
            ]),
            background: colors["editor.background"],
            caret: colors["editorCursor.foreground"] || colors["editorCursor.background"],
            selection:
                colors["editor.selectionBackground"] ||
                colors["editor.selectionHighlightBackground"],
            comment: getTokenColor(["comment"]),
        };
    }

    destroy(destroyState = true) {
        if(this.destroyed) return;
        super.destroy();

        if(destroyState) {
            this.state.destroy();
        }

        this.state = null;
        this.theme = null;
        this.renderEditorFrame = null;
    }
}

export { MutableTextField, EditorState, CodeEditor };