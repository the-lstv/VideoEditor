/**
 * Dynamic variable mapping.
 * @copyright 2026 lstv.space
 * @license GPL-3.0
 */

/**
 * This class represents a variable in the editor that can be tweaked, automated, etc.
 */
class Variable {
    constructor() {
    }

    /**
     * Create
     */
    static create(data) {
    }
}

/**
 * Compiles simple FL-studio-like mapping formulas to JavaScript functions.
 */
const mappingCompiler = new class {
    NOOP_FUNCTION = (x) => x;

    cache = new Map();
    functionMap = {
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
        'y': 'y', 'time': 'y',

        'start': 'start', 'length': 'length',

        'global': 'global'
    };

    /**
     * Process a timeline-based automation item, applying its computed value to its targets at the given time.
     * Not sure if this is the right place for this.
     * 
     * @param {*} automationItem The automation item to process
     * @param {*} time The current time to evaluate the automation at
     * @param {*} timelineInstance The timeline instance the automation item belongs to (used for resolving target nodes)
     * @param {*} adapter The renderer adapter (used for applying values to targets)
     */
    processTimelinedAutomation(automationItem, time, timelineInstance, adapter) {
        if(!automationItem.__automationClip || !automationItem.data || !automationItem.data.targets || automationItem.data.enabled === false || automationItem.data.targets.length === 0) return;

        if (automationItem.data.automationFunction && (automationItem.__dirtyMapping || !automationItem.mappingFn)) {
            try {
                automationItem.mappingFn = mappingCompiler.compile(automationItem.data.automationFunction);
            } catch (e) {
                console.error("Failed to compile automation mapping function:", e);
                automationItem.mappingFn = mappingCompiler.NOOP_FUNCTION;
            }

            automationItem.__dirtyMapping = false;
        } else if(!automationItem.data.automationFunction) {
            automationItem.mappingFn = mappingCompiler.NOOP_FUNCTION;
        }

        const automationValue = automationItem.mappingFn(automationItem.__automationClip.getValueAtTime(time - automationItem.start), time);

        // Use cached targets
        if(automationItem.__cTargets && !automationItem.__dirty) {
            for (const cTarget of automationItem.__cTargets) {
                const baseValue = cTarget.isRelative? cTarget.target.data[cTarget.property] || 0: 0;
                cTarget.setter(cTarget.target, baseValue + cTarget.mappingFn(automationValue, time, cTarget.target.data.start, cTarget.target.data.length));
            }
            return;
        }

        const setters = adapter?.constructor?.nodePropertySetters;
        if(!setters) {
            console.warn("Renderer adapter does not have node property setters, cannot apply automation");
            return;
        }

        // Compile targets
        const compiled = [];
        for (let i = 0; i < automationItem.data.targets.length; i++) {
            const target = automationItem.data.targets[i];

            const targetNode = target.nodeId? timelineInstance.getItemById(target.nodeId): null;
            if(!targetNode) continue;
            if(!targetNode.node) adapter.createObject(targetNode); // ? Should this be here?
            if(!targetNode.node && targetNode.type !== "audio") continue;

            const setter = setters[target.property];
            if(typeof setter !== "function") continue;
            
            const mappingFn = target.__mappingCache || (target.mapping && target.mapping !== "x"? mappingCompiler.compile(target.mapping): mappingCompiler.NOOP_FUNCTION);
            target.__mappingCache = mappingFn;

            const isRelative = target.isRelative;
            const finalValue = isRelative? (targetNode.data[target.property] || 0) + (mappingFn(automationValue, time, targetNode.data.start, targetNode.data.length)): mappingFn(automationValue, time, targetNode.data.start, targetNode.data.length);

            setter(targetNode, finalValue);

            compiled.push({
                setter,
                target: targetNode,
                property: target.property,
                mappingFn,
                isRelative
            });
        }

        automationItem.__cTargets = compiled;
        automationItem.__dirty = false;
    }

    /**
     * Compiles a mapping function from a code string
     * @param {*} code The string code to compile
     * @returns The compiled function
     * 
     * @example
     * const func = mappingCompiler.compile("sin(x) + 2 * x^2");
     * const result = func(1.5); // Evaluate the function at x = 1.5
     */
    compile(code) {
        code = code.trim().toLowerCase();

        if(!code || code.length === 0) {
            return this.NOOP_FUNCTION;
        }

        // todo: this is not a reliable way to keep cache + causes memory leaks.
        // if(this.cache.has(code)) {
        //     return this.cache.get(code);
        // }

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
                const func = this.functionMap[funcName];

                if(func) {
                    if(func === 'x' && operations.length === 0 && funcEnd === code.length) {
                        return this.NOOP_FUNCTION;
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
        const func = new Function('x', 'y', 'start', 'length', generatedCode);
        // this.cache.set(code, func);
        return func;
    }
}

export { Variable, mappingCompiler };