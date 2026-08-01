/**
 * Originally from lstv-web
 * Currently only a part of this is by me, the rest is pure slop garbage
 * I will rewrite this eventually!
 * It's the only component I haven't fully made
 * 
 * @slop
 */
class CommandPalette {
    /**
     * @typedef {Object} InputDefinition
     * @property {string} [name] - Input parameter name
     * @property {'string'|'number'|'boolean'|'color'|'file'|'list'} [type='string'] - Input type
     * @property {string} [description] - Input description
     * @property {string} [icon] - Icon for the input
     * @property {Array<{name: string, description?: string, icon?: string, value: any}>} [list] - Options for list type
     */

    /**
     * @typedef {Object} CommandConfig
     * @property {string} name - Command name (required)
     * @property {string} [icon] - CSS class for the command icon (e.g., 'bi-search')
     * @property {string} [description] - Human-readable description shown in autocomplete
     * @property {string[]} [alias] - Alternative names for this command
     * @property {boolean} [hidden] - If true, command won't appear in autocomplete
     * @property {Function} [onCalled] - The function to execute when command is invoked
     * @property {InputDefinition[]} [inputs] - Input parameters for the command
     * @property {CommandConfig[]|Function} [children] - Nested commands or async loader
     */

    /**
     * @typedef {Object} PaletteOptions
     * @property {HTMLElement} [wrapperElement] - The wrapper container element
     * @property {HTMLInputElement} [inputElement] - The text input element
     * @property {HTMLElement} [menuElement] - The dropdown menu container
     * @property {HTMLElement} [hintElement] - Element to show completion hints
     * @property {HTMLElement} [iconElement] - Element to show current command icon
     * @property {HTMLElement} [textDisplayElement] - Element to mirror input text
     * @property {HTMLElement} [caretElement] - Element to show text caret
     * @property {HTMLElement} [selectionHighlight] - Element to show selection highlight
     * @property {string} [defaultIcon='bi-terminal'] - Default icon when no command selected
     * @property {number} [fontWidth=9.6] - Character width for positioning calculations
     * @property {Function} [onExecute] - Callback before command execution
     * @property {Function} [onComplete] - Callback after command execution
     * @property {Function} [onError] - Callback when command fails
     * @property {Function} [onClose] - Callback when palette is closed
     * @property {Function} [onOpen] - Callback when palette is opened
     * @property {Object} [logger] - Custom logger object with log/error/warn methods
     */

    /** @type {Object} */
    #commands = {};

    /** @type {number} */
    #autoCompletionIndex = 0;

    /** @type {string} */
    #autoCompletionValue = '';
    #autoCompletionRequestToken = 0;

    /** @type {Array<string>|null} */
    #currentCompletions = null;

    /** @type {Object|null} */
    #currentCompletionLocation = null;

    /** @type {PaletteOptions} */
    #options = {};

    /** @type {boolean} */
    #isDestroyed = false;

    /** @type {AbortController} */
    #abortController = null;

    /** @type {number|null} */
    caretFlashInterval = null;

    /** @type {HTMLInputElement|null} */
    #fileInputElement = null;

    /** @type {HTMLInputElement|null} */
    #colorInputElement = null;

    /** @type {Function|null} */
    #pendingFileResolver = null;

    /** @type {boolean} */
    #isInitialized = false;

    /**
     * Creates a new CommandPalette instance
     * @param {PaletteOptions} options - Configuration options
     */
    constructor(options = {}) {
        this.#options = {
            defaultIcon: 'bi-terminal',
            fontWidth: 9.6,
            logger: console,
            ...options
        };

        // Initialize elements in correct order
        this.wrapperElement = this.#options.wrapperElement || null;
        this.inputElement = this.#options.inputElement || null;

        // Create wrapper if not provided but input is
        if (!this.wrapperElement && this.inputElement) {
            this.wrapperElement = this.inputElement.parentElement;
        }

        // Defer menu creation
        this.menuElement = null;

        this.hintElement = this.#options.hintElement || null;
        this.iconElement = this.#options.iconElement || null;
        this.terminalOutput = this.#options.terminalOutput || null;

        this.textDisplayElement = this.#options.textDisplayElement || null;

        this.caretElement = this.#options.caretElement ||
            this.wrapperElement?.querySelector('.command-caret') || null;
        this.selectionHighlight = this.#options.selectionHighlight ||
            this.wrapperElement?.querySelector('.command-selection') || null;

        this.isOpen = false;

        this.#commands = {};
        this.#abortController = new AbortController();

        this.StackRef = { close: () => this.close() };

        this.#bindEvents();
    }

    #ensureInitialized() {
        if (this.#isInitialized) return;
        this.#isInitialized = true;

        // Create menu element if not provided
        if (this.#options.menuElement) {
            this.menuElement = this.#options.menuElement;
        } else if (this.wrapperElement) {
            this.menuElement = document.createElement('div');
            this.menuElement.className = 'completion-menu';
            this.menuElement.style.display = 'none';
            this.wrapperElement.appendChild(this.menuElement);
        }

        // Create hidden file input for file type inputs
        this.#fileInputElement = document.createElement('input');
        this.#fileInputElement.type = 'file';
        this.#fileInputElement.style.display = 'none';
        document.body.appendChild(this.#fileInputElement);
        this.#fileInputElement.addEventListener('change', (e) => this.#handleFileSelect(e));

        // Create hidden color input for color type inputs
        this.#colorInputElement = document.createElement('input');
        this.#colorInputElement.type = 'color';
        this.#colorInputElement.style.display = 'none';
        document.body.appendChild(this.#colorInputElement);
        this.#colorInputElement.addEventListener('change', (e) => this.#handleColorSelect(e));
    }

    #startCaretBlink() {
        if (!this.caretElement) return;
        this.#stopCaretBlink();

        let caretSwitch = false;
        this.caretElement.classList.add('blink');
        this.caretFlashInterval = setInterval(() => {
            caretSwitch = !caretSwitch;
            this.caretElement.classList.toggle('blink', caretSwitch);
        }, 500);
    }

    #stopCaretBlink() {
        if (this.caretFlashInterval) {
            clearInterval(this.caretFlashInterval);
            this.caretFlashInterval = null;
        }
        if (this.caretElement) {
            this.caretElement.classList.remove('blink');
        }
    }


    // PUBLIC API - Command Registration


    /**
     * Registers commands
     * 
     * @param {CommandConfig|CommandConfig[]|string} definition - Command definition(s)
     * @param {CommandConfig} [config] - Config when definition is a string
     * @returns {CommandPalette} Returns this for chaining
     * 
     * @example
     * palette.register([
     *   { name: 'hello', description: 'Say hello', onCalled: (name) => console.log(`Hello, ${name}!`) },
     *   { name: 'theme', description: 'Theme commands', children: [
     *     { name: 'dark', onCalled: () => setTheme('dark') },
     *     { name: 'light', onCalled: () => setTheme('light') }
     *   ]}
     * ]);
     */
    register(definition, config = {}) {
        this.#ensureNotDestroyed();

        if (Array.isArray(definition)) {
            this.#ingestDefinitions(definition, this.#commands);
            return this;
        }

        if (typeof definition === 'string') {
            return this.register([{ name: definition, ...config }]);
        }

        if (definition && typeof definition === 'object') {
            this.#ingestDefinitions([definition], this.#commands);
            return this;
        }

        throw new Error('Invalid command definition');
    }

    /**
     * Unregisters a command or group
     * 
     * @param {string} name - Name of command/group to remove
     * @returns {boolean} True if command existed and was removed
     */
    unregister(name) {
        this.#ensureNotDestroyed();

        const node = this.#commands[name];
        if (!node) return false;

        for (const key of Object.keys(this.#commands)) {
            if (this.#commands[key] === node) {
                delete this.#commands[key];
            }
        }

        return true;
    }

    /**
     * Checks if a command or group exists
     * 
     * @param {string} name - Command/group name
     * @returns {boolean}
     */
    has(name) {
        return name in this.#commands;
    }

    /**
     * Gets a command or group configuration
     * 
     * @param {string} name - Command/group name
     * @returns {CommandConfig|undefined}
     */
    get(name) {
        return this.#commands[name];
    }

    /**
     * Lists all registered top-level command names
     * 
     * @param {Object} [options]
     * @param {boolean} [options.includeHidden=false] - Include hidden commands
     * @returns {string[]}
     */
    list(options = {}) {
        const { includeHidden = false } = options;
        const seen = new Set();

        return Object.entries(this.#commands).reduce((acc, [key, node]) => {
            if (!node) return acc;

            const canonical = node._name || key;
            if (key !== canonical) return acc;
            if (canonical.startsWith('_')) return acc;
            if (!includeHidden && node.hidden) return acc;
            if (seen.has(canonical)) return acc;

            seen.add(canonical);
            acc.push(canonical);
            return acc;
        }, []);
    }


    // PUBLIC API - Command Execution


    /**
     * Executes a command string
     * 
     * @param {string} commandString - Full command with arguments
     * @returns {Promise<any>} Result of command execution
     */
    async execute(commandString) {
        this.#ensureNotDestroyed();

        if (!commandString || typeof commandString !== 'string') {
            return;
        }

        const trimmed = commandString.trim();
        if (!trimmed) return;

        this.#clearInput();
        this.#clearAutoCompletion();

        const parts = this.#parseCommand(trimmed);
        const { command, args, path } = await this.#resolveCommand(parts);

        if (!command) {
            this.#handleError(new Error(`Command "${trimmed}" not found`));
            return;
        }

        this.#options.onExecute?.(trimmed, command, args);

        if (this.__closeAfterExecute) {
            this.close();
            this.__closeAfterExecute = false;
        }

        try {
            const fn = command.onCalled;
            let result = null;

            if (typeof fn === 'function') {
                const coercedArgs = this.#coerceArgs(command, args);
                result = await fn(...coercedArgs);

                const parentGroup = this.#getParentGroup(path);
                if (parentGroup?._after) {
                    parentGroup._after(trimmed);
                }
            }

            this.#options.onComplete?.(trimmed, result);

            return result;
        } catch (error) {
            this.#handleError(error);
            throw error;
        }
    }

    /**
     * Alias for execute()
     * @param {string} commandString 
     * @returns {Promise<any>}
     */
    run(commandString) {
        return this.execute(commandString);
    }


    // PUBLIC API - UI Control


    /**
     * Opens the command palette
     */
    open() {
        this.#ensureNotDestroyed();
        this.#ensureInitialized();

        this.isOpen = true;
        this.#startCaretBlink();

        this.#options.onOpen?.();
        this.focus();

        LS.Stack.push(this.StackRef);

        // Show root suggestions
        this.#scheduleAutoCompletion(this.value);
    }

    /**
     * Closes the command palette
     */
    close() {
        this.#ensureNotDestroyed();
        
        this.isOpen = false;
        this.#stopCaretBlink();

        LS.Stack.remove(this.StackRef);

        this.blur();
        this.#options.onClose?.();
    }

    /**
     * Focuses the command input
     */
    focus() {
        this.#ensureNotDestroyed();
        this.inputElement?.focus();
        this.#updateCaretPosition();
    }

    /**
     * Blurs the command input
     */
    blur() {
        this.#ensureNotDestroyed();
        this.inputElement?.blur();
    }

    /**
     * Clears the command input
     */
    clear() {
        this.#ensureNotDestroyed();
        this.#clearInput();
        this.#clearAutoCompletion();
    }

    /**
     * Shows the autocomplete menu
     */
    showMenu() {
        this.#ensureNotDestroyed();
        if (this.menuElement) {
            this.menuElement.style.display = 'flex';
        }
    }

    /**
     * Hides the autocomplete menu
     */
    hideMenu() {
        this.#ensureNotDestroyed();
        if (this.menuElement) {
            this.menuElement.style.display = 'none';
        }
    }


    /**
     * Opens the palette with a pre-filled command
     * @param {string} command - The command to pre-fill the input with
     */
    openWithCommand(command) {
        if(!this.isOpen) this.__closeAfterExecute = true;

        this.open();
        this.focus();
        this.value = command;
    }

    /**
     * Checks if the autocomplete menu is visible
     * @returns {boolean}
     */
    get isMenuVisible() {
        return !!this.menuElement && this.menuElement.style.display !== 'none';
    }

    /**
     * Checks if the input is focused
     * @returns {boolean}
     */
    get isFocused() {
        return document.activeElement === this.inputElement;
    }

    /**
     * Gets the current input value
     * @returns {string}
     */
    get value() {
        return this.inputElement?.value || '';
    }

    /**
     * Sets the input value
     * @param {string} value
     */
    set value(value) {
        if (this.inputElement) {
            this.inputElement.value = value;
            this.#updateTextDisplay();
            this.#scheduleAutoCompletion(value);
        }
    }

    /**
     * Gets all registered commands (read-only copy)
     * @returns {Object}
     */
    get commands() {
        return { ...this.#commands };
    }


    // PUBLIC API - Lifecycle


    /**
     * Destroys the command palette
     */
    destroy() {
        if (this.#isDestroyed) return;

        this.#isDestroyed = true;
        this.#abortController.abort();
        this.#commands = {};
        this.#clearAutoCompletion();

        this.#stopCaretBlink();

        // Clean up file input
        if (this.#fileInputElement) {
            this.#fileInputElement.remove();
            this.#fileInputElement = null;
        }

        // Clean up color input
        if (this.#colorInputElement) {
            this.#colorInputElement.remove();
            this.#colorInputElement = null;
        }

        this.#pendingFileResolver = null;
    }

    /**
     * Checks if the palette has been destroyed
     * @returns {boolean}
     */
    get isDestroyed() {
        return this.#isDestroyed;
    }


    // PRIVATE - Event Handling


    #bindEvents() {
        if (!this.inputElement) return;

        const signal = this.#abortController.signal;
        this.inputElement.addEventListener('keydown', (e) => this.#handleKeyDown(e), { signal });
        this.inputElement.addEventListener('keyup', (e) => this.#handleKeyUp(e), { signal });
        this.inputElement.addEventListener('input', () => this.#handleInput(), { signal });
        this.inputElement.addEventListener('focus', () => this.#handleFocus(), { signal });
        this.inputElement.addEventListener('blur', () => this.#handleBlur(), { signal });
        this.inputElement.addEventListener('select', () => this.#updateCaretPosition(), { signal });
        this.inputElement.addEventListener('mouseup', () => this.#updateCaretPosition(), { signal });
        this.inputElement.addEventListener('scroll', () => this.#updateCaretPosition(), { signal });

        // Touch support for mobile
        this.inputElement.addEventListener('touchend', () => {
            requestAnimationFrame(() => this.#updateCaretPosition());
        }, { signal });

        document.addEventListener('selectionchange', () => {
            if (document.activeElement === this.inputElement) {
                this.#updateCaretPosition();
            }
        }, { signal });

        // Handle window resize for responsive menu positioning
        window.addEventListener('resize', () => {
            if (this.isMenuVisible) {
                this.#scheduleAutoCompletion(this.value, { preserveIndex: true });
            }
        }, { signal });

        const outsideHandler = (e) => {
            if (this.isMenuVisible &&
                !this.menuElement?.contains(e.target) &&
                !this.inputElement?.contains(e.target)) {
                this.hideMenu();
            }
        };
        document.addEventListener('mousedown', outsideHandler, { signal, passive: true });
        document.addEventListener('touchstart', outsideHandler, { signal, passive: true });
    }

    #handleKeyDown(event) {
        switch (event.key) {
            case 'Enter':
                if (this.isMenuVisible && this.#autoCompletionValue) {
                    this.#acceptCompletion();
                } else {
                    this.execute(this.value);
                }
                event.preventDefault();
                break;

            case 'Tab':
                if (this.#autoCompletionValue) {
                    this.#acceptCompletion();
                }
                event.preventDefault();
                break;

            case 'ArrowDown':
                this.#autoCompletionIndex++;
                this.#scheduleAutoCompletion(this.value, { preserveIndex: true });
                event.preventDefault();
                break;

            case 'ArrowUp':
                this.#autoCompletionIndex--;
                this.#scheduleAutoCompletion(this.value, { preserveIndex: true });
                event.preventDefault();
                break;

            case 'Escape':
                if (this.isMenuVisible) {
                    this.hideMenu();
                } else {
                    this.close();
                }
                event.preventDefault();
                break;

            case 'Dead':
                this.#handleDeadKey(event);
                break;
        }

        requestAnimationFrame(() => this.#updateCaretPosition());
    }

    #handleKeyUp(event) {
        if (event.key === 'Dead') {
            this.#handleDeadKey(event);
        }
        requestAnimationFrame(() => this.#updateCaretPosition());
    }

    #handleInput() {
        this.#updateTextDisplay();
        this.#scheduleAutoCompletion(this.value);
        this.#updateCaretPosition();
    }

    #handleFocus() {
        this.wrapperElement?.classList.add('focused');
    }

    #handleBlur() {
        this.wrapperElement?.classList.remove('focused');
    }

    #handleDeadKey(event) {
        const input = this.inputElement;
        if (!input) return;

        input.blur();
        setTimeout(() => input.focus(), 0);
        event.preventDefault();

        if (input.value.includes('¨')) {
            input.value = input.value.replaceAll('¨', '');
        }
    }


    // PRIVATE - UI Updates


    #clearInput() {
        if (this.inputElement) {
            this.inputElement.value = '';
        }
        this.#updateTextDisplay();
    }

    #updateTextDisplay() {
        if (this.textDisplayElement && this.inputElement) {
            this.textDisplayElement.textContent = this.inputElement.value;
        }
    }

    #updateIcon(command) {
        if (!this.iconElement) return;

        const icon = command?.icon || command?._icon || this.#options.defaultIcon;
        this.iconElement.className = icon;
    }

    #updateHint(completionName, currentPart) {
        if (!this.hintElement) return;

        if (!completionName || currentPart === undefined) {
            this.hintElement.textContent = '';
            return;
        }

        // Show hint if the completion name starts with the current part (case-insensitive comparison for better UX)
        if (currentPart && completionName.toLowerCase().startsWith(currentPart.toLowerCase())) {
            this.hintElement.textContent = completionName.slice(currentPart.length);
        } else {
            this.hintElement.textContent = '';
        }
    }

    #updateCaretPosition() {
        if (!this.inputElement) return;

        const fontWidth = this.#options.fontWidth;
        const selectionStart = this.inputElement.selectionStart ?? 0;
        const selectionEnd = this.inputElement.selectionEnd ?? 0;
        const hasSelection = selectionEnd !== selectionStart;
        const scrollLeft = this.inputElement.scrollLeft || 0;
        const caretLeft = Math.max(0, (selectionEnd * fontWidth) - scrollLeft);

        if (this.caretElement) {
            this.caretElement.style.left = `${caretLeft}px`;
        }

        if (this.selectionHighlight) {
            if (hasSelection) {
                const selectionLeft = Math.max(0, (selectionStart * fontWidth) - scrollLeft);
                const selectionWidth = Math.max(0, (selectionEnd - selectionStart) * fontWidth);
                this.selectionHighlight.style.left = `${selectionLeft}px`;
                this.selectionHighlight.style.width = `${selectionWidth}px`;
            } else {
                this.selectionHighlight.style.width = '0';
            }
        }

        if (this.wrapperElement) {
            this.wrapperElement.classList.toggle('selection', hasSelection);
        }
    }


    // PRIVATE - Autocomplete Logic


    #clearAutoCompletion(options = {}) {
        const { resetIndex = true, clearUI = true } = options;

        this.#autoCompletionValue = '';
        if (resetIndex) {
            this.#autoCompletionIndex = 0;
        }

        // Clear cached completions
        this.#currentCompletions = null;
        this.#currentCompletionLocation = null;

        if (!clearUI) return;

        const { defaultIcon } = this.#options;

        if (this.hintElement) this.hintElement.textContent = '';
        if (this.iconElement) this.iconElement.className = defaultIcon;
        if (this.menuElement) {
            this.#setMenuLoading(false);
            this.menuElement.style.display = 'none';
            this.menuElement.innerHTML = '';
        }
    }

    #scheduleAutoCompletion(value = '', options = {}) {
        this.#updateAutoCompletion(value, options).catch((error) => this.#handleError(error));
    }

    async #updateAutoCompletion(value = '', { preserveIndex = false } = {}) {
        const token = ++this.#autoCompletionRequestToken;

        // If just changing selection and we have cached completions, use fast path
        if (preserveIndex && this.#currentCompletions && this.#currentCompletionLocation) {
            this.#updateSelectionOnly();
            return;
        }

        this.#clearAutoCompletion({ resetIndex: !preserveIndex, clearUI: false });

        const analysis = this.#analyzeInput(value);
        const context = await this.#buildCompletionContext(analysis, token);
        if (token !== this.#autoCompletionRequestToken || context?.cancelled) return;

        if (context.type === 'inputs') {
            this.#renderInputMenu(context);
            return;
        }

        const { children, currentPart } = context;
        const completions = this.#findCompletions(children, currentPart ?? '');

        if (completions.length === 0) {
            this.#clearAutoCompletion({ resetIndex: false, clearUI: true });
            this.#updateCaretPosition();
            return;
        }

        // Cache completions for fast selection updates
        this.#currentCompletions = completions;
        this.#currentCompletionLocation = children;

        this.#wrapAutoCompletionIndex(completions.length);

        const selectedName = completions[this.#autoCompletionIndex];
        const selected = children[selectedName];
        if (!selected) return;

        this.#autoCompletionValue = selected._completionValue ?? selectedName;
        this.#updateIcon(selected);
        this.#updateHint(selectedName, currentPart ?? '');
        this.#setMenuLoading(false);
        this.#updateMenu(children, completions, currentPart ?? '');
        this.#updateCaretPosition();
    }

    #updateSelectionOnly() {
        const completions = this.#currentCompletions;
        const location = this.#currentCompletionLocation;

        if (!completions || !location || !this.menuElement) return;

        this.#wrapAutoCompletionIndex(completions.length);

        const selectedName = completions[this.#autoCompletionIndex];
        const selected = location[selectedName];
        if (!selected) return;

        this.#autoCompletionValue = selected._completionValue ?? selectedName;
        this.#updateIcon(selected);

        // Update hint using the display name, not completion value
        const currentPart = this.#analyzeInput(this.value).currentPart ?? '';
        this.#updateHint(selectedName, currentPart);

        // Update selection classes without rebuilding DOM
        const items = this.menuElement.querySelectorAll('.completion-item');
        items.forEach((item, index) => {
            item.classList.toggle('selected', index === this.#autoCompletionIndex);
        });

        this.#scrollToSelectedItem();
        this.#updateCaretPosition();
    }

    #renderInputMenu(context) {
        const { command, inputIndex, currentPart, inputTokens } = context;
        let inputDef = command.inputs?.[inputIndex];

        // Handle nested types (e.g. list item with type: 'color')
        if (!inputDef && inputIndex > 0) {
            const prevInputIndex = inputIndex - 1;
            const prevInputDef = command.inputs?.[prevInputIndex];
            const prevValue = inputTokens?.[prevInputIndex];

            if (prevInputDef?.type === 'list' && prevValue) {
                const listItem = prevInputDef.list?.find(item =>
                    (item.name || String(item.value)) === prevValue
                );

                if (listItem?.type) {
                    inputDef = listItem;
                }
            }
        }

        if (!inputDef) {
            this.hideMenu();
            this.#autoCompletionValue = '';
            return;
        }

        const options = this.#buildInputCompletionMap(inputDef);
        const completions = this.#findCompletions(options, currentPart ?? '');

        if (completions.length === 0) {
            this.hideMenu();
            this.#autoCompletionValue = '';
            this.#currentCompletions = null;
            this.#currentCompletionLocation = null;
            this.#updateCaretPosition();
            return;
        }

        // Cache completions for fast selection updates
        // (lmao what? slop code aah)
        this.#currentCompletions = completions;
        this.#currentCompletionLocation = options;

        this.#wrapAutoCompletionIndex(completions.length);

        const selectedName = completions[this.#autoCompletionIndex];
        const selected = options[selectedName];
        if (!selected) return;

        this.#autoCompletionValue = selected._completionValue ?? selectedName;
        this.#updateIcon(selected);
        this.#updateHint(selectedName, currentPart ?? '');
        this.#setMenuLoading(false);
        this.#updateMenu(options, completions, currentPart ?? '');
        this.#updateCaretPosition();
    }

    #search(candidates, query, location = null) {
        query = LS.Util.normalize(query);

        if(!query) {
            return candidates.filter(candidate => {
                if (candidate.startsWith('_')) return false;
                if (location && location[candidate]?.hidden) return false;
                return true;
            });
        }

        const results = [];
        for (const candidate of candidates) {
            let text = LS.Util.normalize(candidate);

            if (text.startsWith('_')) continue;

            if (location && location[candidate]) {
                const item = location[candidate];
                if (item.hidden) {
                    continue;
                }

                // if (item.description) {
                //     text += ' ' + LS.Util.normalize(item.description);
                // }
            }

            const idx = text.indexOf(query);
            if (idx === -1) {
                continue;
            }

            let score = 0;

            // Starts with query
            if (idx === 0) score += 100;

            // Starts a word
            if (idx === 0 || text[idx - 1] === ' ') score += 50;

            // Earlier matches are better
            score += Math.max(0, 30 - idx);

            // Shorter strings are slightly preferred
            score -= text.length * 0.01;

            if (score > 0) {
                results.push({ candidate, score });
            }
        }

        return results.sort((a, b) => b.score - a.score).map(r => r.candidate);
    }

    #findCompletions(location = {}, prefix = '') {
        const matches = this.#search(Object.keys(location), prefix, location);

        // Filter out aliases if the canonical command is also in the list
        const canonicalsInList = new Set();
        matches.forEach(key => {
            const item = location[key];
            if (item?._name === key) {
                canonicalsInList.add(item);
            }
        });

        return matches.filter(key => {
            const item = location[key];
            // If this is an alias (key != _name) and the canonical command is already in the list, hide the alias
            if (item?._name && item._name !== key && canonicalsInList.has(item)) {
                return false;
            }
            return true;
        });
    }

    #updateMenu(location, completions, currentPart) {
        const { fontWidth } = this.#options;
        if (!this.menuElement || !this.inputElement) return;

        this.#setMenuLoading(false);

        const scrollLeft = this.inputElement.scrollLeft || 0;
        const anchor = Math.max(0, ((this.inputElement.selectionEnd || 0) * fontWidth) - scrollLeft);

        // Mobile-friendly positioning: check if menu would overflow viewport
        const inputRect = this.inputElement.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const menuWidth = Math.min(600, viewportWidth - 20); // Max ?px or viewport - padding

        let menuLeft = anchor;
        if (inputRect.left + anchor + menuWidth > viewportWidth) {
            // Menu would overflow right, adjust position
            menuLeft = Math.max(0, viewportWidth - inputRect.left - menuWidth - 10);
        }

        this.menuElement.style.left = `${menuLeft}px`;
        this.menuElement.style.maxWidth = `${menuWidth}px`;

        const items = completions
            // .filter(name => !currentPart || name.startsWith(currentPart))
            .map((name, index) => this.#createMenuItem(location, name, index));

        if (items.length > 0) {
            this.menuElement.style.display = 'flex';
            this.menuElement.innerHTML = '';
            items.forEach(item => this.menuElement.appendChild(item));

            // Scroll selected item into view
            this.#scrollToSelectedItem();
        } else {
            this.menuElement.style.display = 'none';
        }
    }

    #scrollToSelectedItem() {
        if (!this.menuElement) return;

        const selectedItem = this.menuElement.querySelector('.completion-item.selected');
        if (selectedItem) {
            selectedItem.scrollIntoView({
                block: 'nearest',
                inline: 'nearest',
                behavior: 'smooth'
            });
        }
    }

    #createMenuItem(location, name, index) {
        const command = location?.[name] || {};
        const hasChildren = this.#hasChildren(command);
        const completionValue = command._completionValue ?? name;

        const item = document.createElement('div');
        item.className = 'completion-item' + (index === this.#autoCompletionIndex ? ' selected' : '');

        // Apply accent color if present
        if (command.accentColor) {
            item.classList.add('has-accent');
            item.setAttribute('ls-accent', command.accentColor);
        }

        // Support both click and touch
        item.onclick = (e) => {
            e.preventDefault();
            this.#autoCompletionIndex = index;
            this.#autoCompletionValue = completionValue;
            this.#acceptCompletion();
        };

        // Prevent touch events from causing focus issues on mobile
        item.ontouchend = (e) => {
            e.preventDefault();
            this.#autoCompletionIndex = index;
            this.#autoCompletionValue = completionValue;
            this.#acceptCompletion();
        };

        const icon = document.createElement('i');
        icon.className = command.icon || command._icon || 'bi-grid-fill';
        item.appendChild(icon);

        const span = document.createElement('span');
        span.textContent = name + (hasChildren ? ' …' : '');
        item.appendChild(span);

        const desc = command.description || command._description || command._inputDescription;
        if (desc) {
            const descSpan = document.createElement('span');
            descSpan.className = 'completion-description';
            descSpan.textContent = ` - ${desc}`;
            item.appendChild(descSpan);
        }

        return item;
    }

    #acceptCompletion = async () => {
        if (!this.inputElement || !this.#autoCompletionValue) return;

        // Retrieve the selected option definition to check for special types
        let selectedOption = null;
        if (this.#currentCompletions && this.#currentCompletionLocation) {
            const name = this.#currentCompletions[this.#autoCompletionIndex];
            selectedOption = this.#currentCompletionLocation[name];
        }

        // Check if this is a file picker selection
        if (this.#autoCompletionValue === '__FILE_PICKER__' || selectedOption?._isFilePicker) {
            this.#openFilePicker();
            return;
        }

        // Check if this is a color picker selection
        if (this.#autoCompletionValue === '__COLOR_PICKER__' || selectedOption?._isColorPicker) {
            this.#openColorPicker();
            return;
        }

        // Clear hint immediately
        if (this.hintElement) {
            this.hintElement.textContent = '';
        }

        const parts = this.#splitCommand(this.inputElement.value);
        if (parts.length === 0) parts.push('');
        parts[parts.length - 1] = this.#autoCompletionValue;

        const cleaned = parts.join(' ').replace(/\s+$/, '');

        // Check if the selected command should be auto-executed
        // (has no inputs and no children)
        // Note: selectedOption might be the command node itself if we are at top level
        const shouldAutoExecute = selectedOption &&
            this.#isRunnable(selectedOption) &&
            !this.#hasChildren(selectedOption) &&
            (!selectedOption.inputs || selectedOption.inputs.length === 0);

        if (shouldAutoExecute) {
            this.inputElement.value = cleaned;
            this.#updateTextDisplay();
            this.execute(cleaned);
            return;
        }

        // Resolve the command to check inputs against definitions
        const parsedParts = this.#parseCommand(cleaned);
        const { command, args } = await this.#resolveCommand(parsedParts);

        // Check if the last argument provided corresponds to a list item with a nested type
        // This prevents premature execution when selecting a list item that requires a subsequent value (e.g. color)
        if (command && command.inputs && args.length > 0) {
            const lastArgIndex = args.length - 1;
            // Ensure we are within bounds of defined inputs
            if (lastArgIndex < command.inputs.length) {
                const inputDef = command.inputs[lastArgIndex];
                const lastArgValue = args[lastArgIndex];

                if (inputDef.type === 'list') {
                    const listItem = inputDef.list?.find(item =>
                        (item.name || String(item.value)) === lastArgValue
                    );

                    if (listItem?.type) {
                        // It has a nested type! Do not execute.
                        // Instead, ensure we show the menu for the nested type.
                        this.inputElement.value = cleaned ? `${cleaned} ` : '';
                        this.#updateTextDisplay();
                        this.#scheduleAutoCompletion(this.inputElement.value);
                        this.#updateCaretPosition();
                        this.inputElement.focus();
                        return;
                    }
                }
            }
        }

        // Check if we have completed all inputs for the current command
        if (command && command.inputs && args.length === command.inputs.length) {
            this.inputElement.value = cleaned;
            this.#updateTextDisplay();
            this.execute(cleaned);
            return;
        }

        this.inputElement.value = cleaned ? `${cleaned} ` : '';

        this.#updateTextDisplay();
        this.#scheduleAutoCompletion(this.inputElement.value);
        this.#updateCaretPosition();
        this.inputElement.focus();
    }

    #openFilePicker() {
        if (!this.#fileInputElement) return;

        this.#fileInputElement.value = ''; // Reset to allow selecting the same file
        this.#fileInputElement.click();
    }

    #handleFileSelect(event) {
        const file = event.target.files?.[0];
        if (!file || !this.inputElement) return;

        const parts = this.#splitCommand(this.inputElement.value);
        if (parts.length === 0) parts.push('');

        // Replace the last part (which was the file picker placeholder) with the file name
        // Use quotes if the filename contains spaces
        const fileName = file.name.includes(' ') ? `"${file.name}"` : file.name;
        parts[parts.length - 1] = fileName;

        const cleaned = parts.join(' ').replace(/\s+$/, '');
        this.inputElement.value = cleaned ? `${cleaned} ` : '';

        // Store the file object for later retrieval
        this.inputElement._selectedFile = file;

        this.#updateTextDisplay();
        this.#scheduleAutoCompletion(this.inputElement.value);
        this.#updateCaretPosition();
        this.inputElement.focus();
    }

    #splitCommand(inputValue) {
        const parts = [];
        let stringChar = null, start = 0;

        for (let i = 0; i < inputValue.length; i++) {
            const char = inputValue.charCodeAt(i);

            if(stringChar) {
                if(char === stringChar) {
                    stringChar = null;
                    parts.push(inputValue.slice(start, i));
                    start = i + 1;
                }
                continue;
            }

            if(char === 34 || char === 39) { // " or '
                parts.push(inputValue.slice(start, i));
                stringChar = char;
                start = i + 1;
                continue;
            }

            if(char === 32) { // space
                parts.push(inputValue.slice(start, i));
                start = i + 1;
            }
        }

        parts.push(inputValue.slice(start));
        return parts.filter(Boolean);
    }

    #openColorPicker() {
        if (!this.#colorInputElement) return;

        this.#colorInputElement.value = '#000000'; // Reset to default
        this.#colorInputElement.click();
    }

    #handleColorSelect(event) {
        const color = event.target.value;
        if (!color || !this.inputElement) return;

        const parts = this.#splitCommand(this.inputElement.value);
        if (parts.length === 0) parts.push('');

        // Replace the last part with the selected color
        parts[parts.length - 1] = color;

        const cleaned = parts.join(' ').replace(/\s+$/, '');
        this.inputElement.value = cleaned ? `${cleaned} ` : '';

        this.#updateTextDisplay();
        this.#scheduleAutoCompletion(this.inputElement.value);
        this.#updateCaretPosition();
        this.inputElement.focus();
    }


    // PRIVATE - Command Resolution & Execution


    #parseCommand(commandString) {
        return this.#splitCommand(commandString.trim());
    }

    async #resolveCommand(parts) {
        let children = this.#commands;
        let currentCommand = null;
        let currentIndex = -1;
        const path = [];

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const node = children?.[part];

            if (!node) {
                // If we found a command and it has no children (or we're past them), treat as input
                if (currentCommand && !this.#hasChildren(currentCommand)) {
                    break;
                }
                return { command: null, args: [], path };
            }

            path.push(part);

            if (this.#isRunnable(node)) {
                currentCommand = node;
                currentIndex = i;
            }

            if (this.#hasChildren(node)) {
                children = await this.#getChildren(node);
            } else {
                children = null;
            }
        }

        if (currentCommand) {
            return { command: currentCommand, args: parts.slice(currentIndex + 1), path };
        }

        return { command: null, args: [], path };
    }

    #getParentGroup(path) {
        if (path.length < 2) return null;

        let children = this.#commands;
        let node = null;

        for (let i = 0; i < path.length - 1; i++) {
            node = children?.[path[i]];
            if (!node) return null;
            children = node._children;
        }

        return node;
    }

    async #buildCompletionContext(analysis, token) {
        const { segments, currentPart, hasTrailingSpace } = analysis;
        let children = this.#commands;
        let commandNode = null;
        let commandPathLength = 0;

        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            const node = children?.[segment];

            if (!node) {
                // If we found a command and it has no children (or we're past them), treat as input
                if (commandNode && !this.#hasChildren(commandNode)) {
                    break;
                }
                return { type: 'children', children: children || {}, currentPart };
            }

            if (this.#hasChildren(node)) {
                children = await this.#getChildren(node, { showLoading: true, token });
                if (token !== this.#autoCompletionRequestToken) {
                    return { cancelled: true };
                }
            } else {
                children = {};
            }

            if (this.#isRunnable(node)) {
                commandNode = node;
                commandPathLength = i + 1;
            }
        }

        const inputTokens = segments.slice(commandPathLength);
        const wantsInputs = commandNode &&
            commandNode.inputs?.length &&
            !this.#hasChildren(commandNode) &&
            (
                segments.length > commandPathLength ||
                hasTrailingSpace ||
                currentPart !== ''
            );

        if (wantsInputs) {
            return {
                type: 'inputs',
                command: commandNode,
                inputIndex: inputTokens.length,
                currentPart,
                inputTokens
            };
        }

        return { type: 'children', children: children || {}, currentPart };
    }

    async #getChildren(node, { showLoading = false, token } = {}) {
        if (!node) return this.#commands;

        // If no loader, just return existing children
        if (!node._loader) {
            node._children = node._children || {};
            return node._children;
        }

        // If already loaded, return cached children
        if (node._childrenLoaded) {
            return node._children || {};
        }

        if (showLoading && token === this.#autoCompletionRequestToken) {
            this.#setMenuLoading(true);
        }

        try {
            const result = await node._loader(node);
            node._children = this.#normalizeChildren(result);
            node._childrenLoaded = true; // Mark as loaded to prevent re-fetching
        } catch (error) {
            this.#handleError(error);
            node._children = {};
        } finally {
            if (showLoading && token === this.#autoCompletionRequestToken) {
                this.#setMenuLoading(false);
            }
        }

        return node._children || {};
    }

    #hasChildren(node) {
        if (!node) return false;
        const hasStaticChildren = node._children && Object.keys(node._children).length > 0;
        return !!(node._loader || hasStaticChildren);
    }

    #isRunnable(node) {
        return typeof node?.onCalled === 'function';
    }

    #buildInputCompletionMap(inputDef) {
        const type = (inputDef.type || 'string').toLowerCase();

        if (type === 'boolean') {
            return {
                true: {
                    _type: 'input-option',
                    _completionValue: 'true',
                    icon: 'bi-toggle-on',
                },
                false: {
                    _type: 'input-option',
                    _completionValue: 'false',
                    icon: 'bi-toggle-off',
                }
            };
        }

        if (type === 'number') {
            const options = {
                '0': {
                    _type: 'input-option',
                    _completionValue: '0',
                    icon: inputDef.icon || 'bi-123',
                    description: 'Zero'
                },
                '1': {
                    _type: 'input-option',
                    _completionValue: '1',
                    icon: inputDef.icon || 'bi-123',
                    description: 'One'
                },
                '10': {
                    _type: 'input-option',
                    _completionValue: '10',
                    icon: inputDef.icon || 'bi-123',
                    description: 'Ten'
                },
                '100': {
                    _type: 'input-option',
                    _completionValue: '100',
                    icon: inputDef.icon || 'bi-123',
                    description: 'Hundred'
                }
            };

            // Add a hint entry for the input description
            if (inputDef.description) {
                options['(enter a number)'] = {
                    _type: 'input-hint',
                    _completionValue: '',
                    icon: inputDef.icon || 'bi-123',
                    description: inputDef.description,
                    hidden: false
                };
            }

            return options;
        }

        if (type === 'color') {
            return {
                'Pick color...': {
                    _type: 'input-option',
                    _completionValue: '__COLOR_PICKER__',
                    _isColorPicker: true,
                    icon: inputDef.icon || 'bi-palette',
                    description: inputDef.description || 'Open color picker'
                },
                '#000000': {
                    _type: 'input-option',
                    _completionValue: '#000000',
                    icon: 'bi-circle-fill',
                    description: 'Black'
                },
                '#ffffff': {
                    _type: 'input-option',
                    _completionValue: '#ffffff',
                    icon: 'bi-circle',
                    description: 'White'
                },
                '#ff0000': {
                    _type: 'input-option',
                    _completionValue: '#ff0000',
                    icon: 'bi-circle-fill',
                    description: 'Red',
                    accentColor: 'red'
                },
                '#00ff00': {
                    _type: 'input-option',
                    _completionValue: '#00ff00',
                    icon: 'bi-circle-fill',
                    description: 'Green',
                    accentColor: 'green'
                },
                '#0000ff': {
                    _type: 'input-option',
                    _completionValue: '#0000ff',
                    icon: 'bi-circle-fill',
                    description: 'Blue',
                    accentColor: 'blue'
                },
                '#ffff00': {
                    _type: 'input-option',
                    _completionValue: '#ffff00',
                    icon: 'bi-circle-fill',
                    description: 'Yellow',
                    accentColor: 'yellow'
                },
                '#ff00ff': {
                    _type: 'input-option',
                    _completionValue: '#ff00ff',
                    icon: 'bi-circle-fill',
                    description: 'Magenta',
                    accentColor: 'purple'  // Close enough 😭
                },
                '#00ffff': {
                    _type: 'input-option',
                    _completionValue: '#00ffff',
                    icon: 'bi-circle-fill',
                    description: 'Cyan',
                    accentColor: 'teal'  // Close enough 😭
                }
            };
        }

        if (type === 'list') {
            const result = {};

            for (const item of (inputDef.list || [])) {
                const key = item.name || String(item.value);
                result[key] = {
                    _type: 'input-option',
                    _completionValue: String(item.value ?? item.name),
                    icon: item.icon || inputDef.icon || 'bi-list',
                    description: item.description || inputDef.description,
                    accentColor: item.accentColor
                };
            }

            return result;
        }

        if (type === 'file') {
            return {
                'Browse...': {
                    _type: 'input-option',
                    _completionValue: '__FILE_PICKER__',
                    _isFilePicker: true,
                    icon: inputDef.icon || 'bi-folder2-open',
                    description: inputDef.description || 'Select a file'
                }
            };
        }

        // For string - show a hint with the input description
        if (type === 'string') {
            const options = {};

            if (inputDef.description || inputDef.name) {
                const hintText = inputDef.description || `Enter ${inputDef.name}`;
                options['(enter text)'] = {
                    _type: 'input-hint',
                    _completionValue: '',
                    icon: inputDef.icon || 'bi-fonts',
                    description: hintText,
                    hidden: false
                };
            }

            return options;
        }

        return {};
    }

    #analyzeInput(value = '') {
        const safeValue = value ?? '';
        const hasTrailingSpace = /\s$/.test(safeValue);
        let segments = safeValue.trim() ? safeValue.trim().split(/\s+/) : [];
        let currentPart = '';

        if (!hasTrailingSpace && segments.length > 0) {
            currentPart = segments.pop() || '';
        }

        return { segments, currentPart, hasTrailingSpace };
    }

    #wrapAutoCompletionIndex(length) {
        if (length === 0) {
            this.#autoCompletionIndex = 0;
            return;
        }

        if (this.#autoCompletionIndex < 0) {
            this.#autoCompletionIndex = length - 1;
        }

        if (this.#autoCompletionIndex >= length) {
            this.#autoCompletionIndex = 0;
        }
    }

    #coerceArgs(command, args) {
        if (!command?.inputs?.length) return args;

        const coerced = [];
        let argIndex = 0;

        for (let i = 0; i < command.inputs.length; i++) {
            const input = command.inputs[i];
            const raw = args[argIndex];

            // Handle list items with nested types
            if (input.type === 'list' && raw) {
                const listItem = input.list?.find(item =>
                    (item.name || String(item.value)) === raw
                );

                if (listItem?.type && argIndex + 1 < args.length) {
                    const nestedValue = args[argIndex + 1];
                    coerced.push(this.#coerceValue(nestedValue, listItem));
                    argIndex += 2;
                    continue;
                }
            }

            coerced.push(this.#coerceValue(raw, input));
            argIndex++;
        }

        if (argIndex < args.length) {
            coerced.push(...args.slice(argIndex));
        }

        return coerced;
    }

    #coerceValue(value, input) {
        if (value === undefined || value === null) return value;

        switch ((input.type || 'string').toLowerCase()) {
            case 'number': {
                const num = Number(value);
                return Number.isNaN(num) ? value : num;
            }
            case 'boolean': {
                if (typeof value === 'boolean') return value;
                const normalized = String(value).toLowerCase();
                if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
                if (['false', '0', 'no', 'off'].includes(normalized)) return false;
                return value;
            }
            case 'list': {
                const match = (input.list || []).find(item => {
                    const target = item.value ?? item.name;
                    return String(target) === String(value);
                });
                return match ? match.value : value;
            }
            case 'color':
            case 'file':
            case 'string':
            default:
                return value;
        }
    }

    #setMenuLoading(state) {
        if (!this.menuElement) return;

        this.menuElement.classList.toggle('loading', !!state);
        this.menuElement.setAttribute('aria-busy', state ? 'true' : 'false');

        if (state) {
            // Clear previous menu items when showing loading state
            this.menuElement.innerHTML = '';
            this.menuElement.style.display = 'flex';

            let overlay = document.createElement('div');
            overlay.className = 'command-menu-loading';
            overlay.textContent = 'Loading…';
            this.menuElement.appendChild(overlay);
        } else {
            let overlay = this.menuElement.querySelector('.command-menu-loading');
            if (overlay) {
                overlay.remove();
            }
        }
    }


    // PRIVATE - Command Normalization


    #normalizeNode(config = {}, options = {}) {
        if (typeof config === 'function') {
            return {
                _type: 'command',
                _name: options.name || 'anonymous',
                onCalled: config,
                alias: [],
                inputs: [],
                _children: {}
            };
        }

        if (!config || typeof config !== 'object') {
            throw new Error('Command definition must be an object');
        }

        const name = config.name || options.name;
        if (!name) {
            throw new Error('Command definition requires a name');
        }

        const node = {
            ...config,
            _name: name,
            _type: (config.onCalled) ? 'command' : 'group',
            alias: Array.isArray(config.alias) ? config.alias.filter(Boolean) : [],
            inputs: this.#normalizeInputs(config.inputs),
            onCalled: config.onCalled,
            _children: {},
            _childrenLoaded: false // Track if async children have been loaded
        };

        // Handle children - can be array or async function
        const childSource = config.children;

        if (typeof childSource === 'function') {
            node._loader = childSource;
            node._childrenLoaded = false;
        } else if (Array.isArray(childSource)) {
            node._children = this.#normalizeChildren(childSource);
            node._childrenLoaded = true; // Static children are already "loaded"
        }

        return node;
    }

    #normalizeInputs(inputs) {
        if (!Array.isArray(inputs)) return [];

        return inputs.map((input, index) => {
            if (!input || typeof input !== 'object') {
                return { name: `input${index + 1}`, type: 'string' };
            }

            const normalized = { ...input };
            normalized.name = (input.name && String(input.name).trim()) || `input${index + 1}`;
            normalized.type = (input.type || 'string').toLowerCase();

            if (normalized.type === 'list') {
                normalized.list = this.#normalizeListOptions(input.list);
            }

            return normalized;
        });
    }

    #normalizeListOptions(list) {
        if (!Array.isArray(list)) return [];

        return list.map((item, index) => {
            if (!item || typeof item !== 'object') {
                return { name: String(item), value: item };
            }

            return {
                name: item.name || `option${index + 1}`,
                description: item.description,
                icon: item.icon,
                value: item.value ?? item.name ?? index,
                accentColor: item.accentColor,
                type: item.type // Preserve nested type for list items
            };
        });
    }

    #normalizeChildren(definitions) {
        const target = {};
        this.#ingestDefinitions(definitions, target);
        return target;
    }

    #ingestDefinitions(definitions, target) {
        if (!Array.isArray(definitions)) {
            definitions = this.#coerceDefinitions(definitions);
        }

        for (const def of definitions) {
            if (!def || typeof def !== 'object') continue;
            if (!def.name || typeof def.name !== 'string') {
                throw new Error('Command definition requires a name');
            }

            const node = this.#normalizeNode(def);
            node._parentChildren = target;
            target[node._name] = node;

            for (const alias of node.alias || []) {
                if (typeof alias === 'string' && alias.trim()) {
                    target[alias] = node;
                }
            }
        }

        return target;
    }

    #coerceDefinitions(value) {
        if (!value) return [];

        if (value instanceof Map) {
            return Array.from(value.entries()).map(([name, def]) => {
                if (def && typeof def === 'object') return { name, ...def };
                if (typeof def === 'function') return { name, onCalled: def };
                return { name };
            });
        }

        if (typeof value === 'object') {
            return Object.entries(value).map(([name, def]) => {
                if (def && typeof def === 'object') return { name, ...def };
                if (typeof def === 'function') return { name, onCalled: def };
                return { name };
            });
        }

        return [];
    }


    // PRIVATE - Logging & Error Handling


    #log(level, ...args) {
        const { logger } = this.#options;
        if (!logger || typeof logger[level] !== 'function') return;

        try {
            logger[level](...args);
        } catch (error) {
            // Silently fail if logger errors
        }
    }

    #handleError(error) {
        this.#log('error', error);
        this.#options.onError?.(error);
    }

    #ensureNotDestroyed() {
        if (this.#isDestroyed) {
            throw new Error('CommandPalette instance has been destroyed');
        }
    }

    log(...args) {
        if (!this.terminalOutput) return this.#log(...args);

        const line = LS.Create("div", { class: "terminal-line" });

        // Check if first arg contains styles (%c)
        if (typeof args[0] === "string" && args[0].includes("%c")) {
            let str = args[0];
            let styleIndex = 1;
            const parts = str.split("%c");

            parts.forEach((part, i) => {
                if (i === 0) {
                    line.append(document.createTextNode(part));
                } else {
                    const style = args[styleIndex++] || "";
                    const span = LS.Create("span", {
                        textContent: part,
                        style: style
                    });
                    line.append(span);
                }
            });

            // Append remaining args (non-style)
            for (let i = styleIndex; i < args.length; i++) {
                line.append(document.createTextNode(" "));
                line.append(this.#serializeValue(args[i]));
            }
        } else {
            // No styles, serialize all args
            args.forEach((arg, i) => {
                if (i > 0) line.append(document.createTextNode(" "));
                line.append(this.#serializeValue(arg));
            });
        }

        this.terminalOutput.append(line);
        this.terminalOutput.parentElement.scrollTop = this.terminalOutput.parentElement.scrollHeight;
    }

    #serializeValue(value) {
        if (value === null) return LS.Create("span", { textContent: "null", class: "terminal-null" });
        if (value === undefined) return LS.Create("span", { textContent: "undefined", class: "terminal-undefined" });

        const type = typeof value;

        if (type === "string") {
            return LS.Create("span", { textContent: value, class: "terminal-string" });
        }
        if (type === "number") {
            return LS.Create("span", { textContent: String(value), class: "terminal-number" });
        }
        if (type === "boolean") {
            return LS.Create("span", { textContent: String(value), class: "terminal-boolean" });
        }
        if (type === "function") {
            return LS.Create("span", { textContent: value.toString(), class: "terminal-function" });
        }

        // Handle Error objects
        if (value instanceof Error) {
            return LS.Create("span", {
                textContent: value.toString(),
                class: "terminal-error"
            });
        }

        // Handle objects and arrays
        if (type === "object") {
            const isArray = Array.isArray(value);
            const typeName = isArray ? "Array" : (value.constructor?.name || "Object");
            const preview = isArray
                ? `(${value.length})`
                : `{${Object.keys(value).slice(0, 3).join(", ")}${Object.keys(value).length > 3 ? "..." : ""}}`;

            const wrapper = LS.Create("span", { class: "terminal-object" });
            const toggle = LS.Create("span", {
                class: "terminal-object-toggle",
                textContent: "▶ ",
                style: "cursor: pointer; user-select: none;"
            });
            const header = LS.Create("span", {
                class: "terminal-object-header",
                innerHTML: `<i class="bi-${isArray ? 'list-ul' : 'braces'}"></i> ${typeName} ${preview}`
            });
            const content = LS.Create("pre", {
                class: "terminal-object-content",
                textContent: JSON.stringify(value, null, 2),
                style: "display: none; margin-left: 20px; padding: 5px; background: rgba(0,0,0,0.1);"
            });

            toggle.onclick = () => {
                const isExpanded = content.style.display !== "none";
                content.style.display = isExpanded ? "none" : "block";
                toggle.textContent = isExpanded ? "▶ " : "▼ ";
            };

            wrapper.append(toggle, header, content);
            return wrapper;
        }

        return document.createTextNode(String(value));
    }
}


// // --- lstv.space specific

// function init(kernel, website, LoggerContext) {
//     const topBar = LS.SelectOne("#topOverlay");

//     topBar.innerHTML = `<div id="commandTerminal" class="level-n3" style="display: none">
//     <div class="terminal-output"></div>
// </div>

// <div id="commandPaletteBar" class="level-n3">
//     <div id="commandPalette" onclick="this.querySelector('.command-input').focus()">
//         <div class="completion-menu"></div>

//         <i class="bi-terminal command-icon"></i>

//         <div class="textContainer">
//             <span class="command-selection"></span>
//             <span class="command-caret"></span>
//             <span class="command-text"></span><span class="command-hint"></span>
//             <input type="text" class="command-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Command palette input">
//         </div>
//     </div>

//     <div class="command-palette-buttons">
//         <button ls-tooltip="Close" class="square clear" aria-label="Close command palette"><i class="bi-x-lg"></i></button>
//     </div>
// </div>`;

// const paletteBar = LS.SelectOne("#commandPaletteBar");
// const paletteContainer = LS.SelectOne("#commandPalette");
// const terminalContainer = LS.SelectOne("#commandTerminal");
// const terminalOutput = terminalContainer.querySelector(".terminal-output");

//     const paletteLogger = new LoggerContext("Command Palette");
//     website.palette = new CommandPalette({
//         wrapperElement: paletteContainer,
//         menuElement: paletteContainer.querySelector(".completion-menu"),
//         iconElement: paletteContainer.querySelector(".command-icon"),
//         textDisplayElement: paletteContainer.querySelector(".command-text"),
//         hintElement: paletteContainer.querySelector(".command-hint"),
//         inputElement: paletteContainer.querySelector(".command-input"),
//         terminalOutput: terminalOutput,

//         fontWidth: 9.6 * 1.2,

//         onClose(){
//             LS.Animation.fadeOut(topBar, 300, "down");
//         },

//         onOpen(){
//             LS.Animation.fadeIn(topBar, 300, "up");
//         },

//         logger: paletteLogger
//     });

//     let terminalHidden = true;
//     const terminalObserver = new MutationObserver(() => {
//         const hasContent = terminalOutput.children.length > 0;
//         if (hasContent) {
//             if (terminalHidden) {
//                 LS.Animation.fadeIn(terminalContainer, 200, "up");
//                 terminalHidden = false;
//             }
//         } else {
//             if (!terminalHidden) {
//                 LS.Animation.fadeOut(terminalContainer, 200, "down");
//                 terminalHidden = true;
//             }
//         }
//     });

//     terminalObserver.observe(terminalOutput, { childList: true });

//     const terminalWriter = {
//         log: website.palette.log.bind(website.palette)
//     }

//     kernel.terminalWriter = terminalWriter;
//     paletteLogger.writer = terminalWriter;

//     paletteBar.querySelector("button").onclick = () => {
//         website.palette.close();
//     };

//     /**
//      * This should later be inline, so we don't waste client memory & work. 
//      * That's when we use Glitter
//      */

//     /*comptime*/ const kVersionMeta = {
//         1: {
//             codename: "Zen",
//             color: "#B5FFEE"
//         },
//         2: {
//             codename: "Aether",
//             color: "#FFA680"
//         },
//         3: {
//             codename: "Forge",
//             color: "#8C80FF"
//         }
//     }

//     /*comptime*/ const ckMeta = kVersionMeta[kernel.version.split(".")[0]] || { codename: "Unknown", color: "var(--accent)" };

//     website.palette.register([
//         {
//             name: "kernel-info",
//             alias: ["kernel-version", "version"],
//             icon: 'bi-cpu-fill',
//             description: "Show kernel information",
//             async onCalled() {
//                 terminalOutput.appendChild(LS.Create({
//                     innerHTML: `<img src="/~/assets/image/kernel-icons/${kernel.version.split(".")[0]}x.png" width="180" style="position:absolute;top:20px"><svg xmlns="http://www.w3.org/2000/svg" width="200" height="180" viewBox="0 0 200 180" fill="none">
// <rect x="59" y="63" width="82" height="28.9828" fill="black"/>
// <rect x="59" y="91.9828" width="82" height="24.7414" fill="${ckMeta.color}"/>
// <text fill="black" style="white-space: pre" xml:space="preserve" font-family="JetBrains Mono" font-size="16.9655" font-weight="300" letter-spacing="0em"><tspan x="70.0855" y="110.504">v${kernel.version.split("-")[0]}</tspan></text>
// <text fill="${ckMeta.color}" style="white-space: pre" xml:space="preserve" font-family="JetBrains Mono" font-size="22.6207" font-weight="500" letter-spacing="0em"><tspan x="66.0693" y="86.1434">[${ckMeta.codename}]</tspan></text>
// </svg>`,
//                     style: 'margin:auto;display:flex;justify-content:center;position:relative'
//                 }));

//                 terminalWriter.log(
//                     `%clstv.space%c kernel`,
//                     "color:var(--accent);font-weight:bold;font-size:1.2em",
//                     "color:inherit;font-weight:bold;font-size:1.2em"
//                 );
//                 terminalWriter.log(
//                     `%cVersion:%c ${kernel.version} (${ckMeta.codename})`,
//                     "color:var(--accent);font-weight:bold", "color:inherit"
//                 );
//                 terminalWriter.log(
//                     `%cLS version:%c ${LS.version}`,
//                     "color:var(--accent);font-weight:bold", "color:inherit"
//                 );
//                 terminalWriter.log(
//                     `%cViewports:%c ${kernel.viewports.size}`,
//                     "color:var(--accent);font-weight:bold", "color:inherit"
//                 );
//                 terminalWriter.log(
//                     `%cPages:%c ${kernel.pageCache.size} / 20`,
//                     "color:var(--accent);font-weight:bold", "color:inherit"
//                 );
//                 terminalWriter.log(
//                     `%cThreads:%c ${kernel.threads.size} / ${kernel.MAX_THREADS}`,
//                     "color:var(--accent);font-weight:bold", "color:inherit"
//                 );
//                 terminalWriter.log(
//                     `%cWindows:%c ${kernel.windows.size}`,
//                     "color:var(--accent);font-weight:bold", "color:inherit"
//                 );
//                 terminalWriter.log(
//                     `%cSigned in:%c ${await kernel.auth.isLoggedIn() ? "Yes" : "No"}`,
//                     "color:var(--accent);font-weight:bold", "color:inherit"
//                 );
//                 terminalWriter.log(
//                     `%cLoadtime:%c ${Math.round(kernel.ttl)}ms (${Math.round(kernel.ttl_scripting)}ms without network)`,
//                     "color:var(--accent);font-weight:bold", "color:inherit"
//                 );
//                 const uptimeMs = Date.now() - window.__loadTime;
//                 const uptimeSec = Math.floor(uptimeMs / 1000);
//                 const hours = Math.floor(uptimeSec / 3600);
//                 const minutes = Math.floor((uptimeSec % 3600) / 60);
//                 const seconds = uptimeSec % 60;
//                 const prettyUptime =
//                     (hours > 0 ? hours + "h " : "") +
//                     (minutes > 0 ? minutes + "m " : "") +
//                     seconds + "s";
//                 terminalWriter.log(
//                     `%cUptime:%c ${prettyUptime}`,
//                     "color:var(--accent);font-weight:bold", "color:inherit"
//                 );
//             }
//         },

//         {
//             name: "settings",
//             icon: "bi-gear",
//             description: "More settings",
//             children: [
//                 // {
//                 //     name: "notifications",
//                 //     icon: "bi-bell",
//                 //     description: "Enable or disable notifications",
//                 //     children: [
//                 //         {
//                 //             name: "enable",
//                 //             icon: "bi-bell-fill",
//                 //             description: "Enable notifications",
//                 //         },
//                 //         {
//                 //             name: "disable",
//                 //             icon: "bi-bell-slash",
//                 //             description: "Disable notifications",
//                 //         }
//                 //     ]
//                 // },

//                 {
//                     name: "privacy",
//                     icon: "bi-shield-lock",
//                     description: "Privacy settings",
//                     children: [
//                         {
//                             name: "statistics",
//                             icon: "bi-bar-chart",
//                             description: "Toggle anonymous statistics sharing",
//                             onCalled(enabled) {
//                                 localStorage.setItem("DISABLE_STATS", !enabled);
//                                 terminalWriter.log("Statistics sharing " + (enabled ? "enabled - Thank you!" : "disabled - No statistics data will be sent from this browser from now on."));

//                                 if(!enabled) {
//                                     terminalWriter.log("Warning: This setting is not saved to your account and is specific to this browser. Make sure to update this setting on other devices.");
//                                 }
//                             },
//                             inputs: [
//                                 {
//                                     name: "enabled",
//                                     type: "boolean",
//                                     default: true
//                                 }
//                             ]
//                         }
//                     ]
//                 },

//                 {
//                     name: "performance-mode",
//                     icon: "bi-speedometer",
//                     description: "Set performance mode",

//                     onCalled(value) {
//                         window.LOW_PERFORMANCE_MODE = value === "low";
//                         localStorage.setItem("LOW_PERFORMANCE_MODE", window.LOW_PERFORMANCE_MODE);
//                         terminalWriter.log("Warning: It is recommended to reload the page for this setting to take effect");
//                     },

//                     inputs: [ {
//                         name: "mode",
//                         type: "list",
//                         list: [
//                             { name: "Normal", description: "Recommended", value: "normal" },
//                             { name: "Low", description: "Disables some visual effects", value: "low" },
//                         ]
//                     } ]
//                 },
//             ]
//         },

//         {
//             name: "toolbar",
//             icon: "bi-tools",
//             description: "Toolbars",
//             onCalled(toolbar) {
//                 website.openToolbar(toolbar);
//                 website.palette.close();
//             },

//             inputs: [
//                 {
//                     name: "toolbar",
//                     type: "list",
//                     list: [
//                         { name: "Accounts", value: "login", icon: "bi-person-circle" },
//                         { name: "Apps", value: "apps", icon: "bi-app" },
//                         { name: "Music Player", value: "musicPlayer", icon: "bi-music-note" },
//                         { name: "Customize website", value: "theme", icon: "bi-brush" },
//                         { name: "Assistant", value: "assistant", icon: "bi-robot" }
//                     ]
//                 }
//             ]
//         },

//         {
//             name: "apps",
//             icon: "bi-window",
//             description: "Applications",

//             children: [
//                 {
//                     name: "open",
//                     icon: "bi-box-arrow-up-right",
//                     description: "Open an app",
//                     children() {
//                         return [...kernel.appManifests.values()].map(app => ({ name: app.name.replace(/\s+/g, '_'), value: app.id, icon: app.icon, onCalled() {
//                             kernel.openApplication(app, { source: "palette" })
//                                 // .loading(() => {}) // TODO: loading mark for the palette
//                                 .done((instance) => {
//                                     instance.open?.();
//                                     website.palette.close();
//                                 })
//                                 .catch(error => {
//                                     terminalWriter.log("Failed to open app: " + (error.message || error.error || "Unknown error"));
//                                 });
//                         }}));
//                     }
//                 },

//                 {
//                     name: "uninstall",
//                     icon: "bi-trash",
//                     description: "Uninstall an app",
//                 },

//                 {
//                     name: "install",
//                     icon: "bi-download",
//                     description: "Install an app",
//                 },

//                 {
//                     name: "sync",
//                     icon: "bi-arrow-repeat",
//                     description: "Enable sync for an app",
//                 },

//                 {
//                     name: "unsync",
//                     icon: "bi-x-lg",
//                     description: "Disable sync for an app",
//                 },

//                 {
//                     name: "auth",
//                     icon: "bi-shield-lock",
//                     description: "Authenticate"
//                 },

//                 {
//                     name: "manage-permissions",
//                     icon: "bi-shield-lock",
//                     description: "Manage app permissions",
//                 }
//             ]
//         },

//         {
//             name: "echo",
//             alias: ["print"],
//             icon: "bi-chat",
//             description: "Echo input",
//             onCalled(text) { terminalWriter.log(text) },
//             inputs: [
//                 { name: "text", type: "string", description: "Text to echo" }
//             ]
//         },

//         {
//             name: "clear",
//             icon: "bi-trash",
//             alias: ["clear-terminal", "cls"],
//             description: "Clear the terminal output",
//             onCalled() { terminalOutput.innerHTML = "" }
//         },

//         {
//             name: "close",
//             alias: ["exit"],
//             icon: "bi-x-circle",
//             description: "Close the command palette",
//             onCalled() { website.palette.close() }
//         }
//     ]);
// }

export { CommandPalette };