/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2026
    License: GPL-3.0

    Semantic versioning class for managing and comparing version numbers.
    From Akeno
*/

export default class Version {
    /**
     * @description Version class for managing and comparing version numbers
     * @param {number|string|array<number|string>|object} major - Major version number, or a string, array or object containing version information
     * @param {number} minor - Minor version number
     * @param {number} patch - Patch version number
     * @param {string} release - Pre-release version string
     * @param {string} build - Build metadata string
     * 
     * @example
     * new Version("1.2.*") // Version { major: 1, minor: 2, patch: 0 }
     * new Version(1) // Version { major: 1, minor: 0, patch: 0 }
     * new Version([1, 2, "*"]) // Version { major: 1, minor: 2, patch: 0 }
     * new Version(new Version(1, 2, "*")) // Version { major: 1, minor: 2, patch: 0 }
     * new Version({ major: 1, minor: 2, patch: "*" }) // Version { major: 1, minor: 2, patch: 0 }
     */
    constructor(major, minor, patch, release = null, build = null){
        this.wildcardMask = 0b000;
        this.set(major, minor, patch, release, build);
    }

    toString(){
        return `${this.major}.${this.minor}.${this.patch}${this.release ? '-' + this.release : ''}${this.build ? '+' + this.build : ''}`;
    }

    toJSON(){
        return {
            major: this.major,
            minor: this.minor,
            patch: this.patch,
            release: this.release,
            build: this.build
        };
    }

    /**
     * Sets the version components.
     * 
     * "major" can instead be a semver string (or array/object/other version instance), which will be correctly parsed into major, minor, patch, release, and build components using the following syntax:
     * major.minor.patch-release+build
     * 
     * @param {number|string|array<number|string>|object} major Major version number, or a string, array or object containing version information
     * @param {number} minor Minor version number
     * @param {number} patch Patch version number
     * @param {string} release Pre-release version string
     * @param {string} build Build metadata string
     * @returns {Version} The updated Version instance
     */
    set(major = 0, minor = 0, patch = 0, release = null, build = null){
        if(Array.isArray(major)){
            this.major = major[0];
            this.minor = major[1];
            this.patch = major[2];
            this.release = major[3] || null;
            this.build = major[4] || null;
        } else if(major instanceof Version || typeof major === 'object' && major !== null){
            this.major = major.major;
            this.minor = major.minor;
            this.patch = major.patch;
            this.release = major.release || null;
            this.build = major.build || null;
        } else if(typeof major === 'string'){
            const firstIndex = major.indexOf(".");
            if(firstIndex === -1){
                this.major = major;
                this.minor = 0;
                this.patch = 0;
                this.release = null;
                this.build = null;
                return this;
            }

            const secondIndex = major.indexOf(".", firstIndex + 1);
            if(secondIndex === -1){
                this.major = major.substring(0, firstIndex);
                this.minor = major.substring(firstIndex + 1);
                this.patch = 0;
                this.release = null;
                this.build = null;
                return this;
            }

            this.major = major.substring(0, firstIndex) || "0";
            this.minor = major.substring(firstIndex + 1, secondIndex) || "0";

            this.release = null;
            this.build = null;

            // Handle pre-release and build metadata
            const preReleaseIndex = major.indexOf("-", secondIndex + 1);
            const buildIndex = major.indexOf("+", preReleaseIndex !== -1? preReleaseIndex + 1: secondIndex + 1);

            if (preReleaseIndex !== -1) {
                this.release = major.substring(preReleaseIndex + 1, buildIndex !== -1 ? buildIndex : undefined);
            }

            if (buildIndex !== -1) {
                this.build = major.substring(buildIndex + 1);
            }

            this.patch = major.substring(secondIndex + 1, buildIndex !== -1 ? buildIndex : preReleaseIndex !== -1 ? preReleaseIndex : undefined) || "0";
        } else {
            this.major = major;
            this.minor = minor;
            this.patch = patch;
            this.release = release || null;
            this.build = build || null;
        }

        if(this.major === "*" || this.major === "x"){
            this.wildcardMask |= 0b100;
        }

        if(this.minor === "*" || this.minor === "x"){
            this.wildcardMask |= 0b010;
        }

        if(this.patch === "*" || this.patch === "x"){
            this.wildcardMask |= 0b001;
        }

        this.major = Math.floor(Number(this.major) || 0);
        this.minor = Math.floor(Number(this.minor) || 0);
        this.patch = Math.floor(Number(this.patch) || 0);

        return this;
    }

    setRelease(release){
        if(typeof release !== "string" || release.length === 0){
            this.release = null;
            return this;
        }
        
        this.release = release;
        return this;
    }

    setBuild(build){
        if(typeof build !== "string" || build.length === 0){
            this.build = null;
            return this;
        }

        this.build = build;
        return this;
    }

    increment(major = 0, minor = 0, patch = 0){
        if(typeof major !== 'number' && major !== null && major !== undefined && (typeof major === "string"? major.indexOf(".") !== -1 : true)){
            const version = new Version(major);
            major = version.major;
            minor = version.minor;
            patch = version.patch;
        }

        this.set(
            this.major + (major || 0),
            this.minor + (minor || 0),
            this.patch + (patch || 0)
        );

        return this;
    }

    compare(comparator){
        if(typeof comparator !== 'string'){
            return Version.matches(this, comparator);
        }

        if(comparator.length === 0 || comparator === "any" || comparator === "*"){
            return true;
        }

        const rules = comparator.split("||");
        for(let rule of rules) {
            rule = rule.trim();

            if(rule.length === 0){
                continue;
            }

            if(rule === "any" || rule === "*"){
                return true;
            }

            let result = false;
            for(let part of rule.split(" ")){
                part = part.trim();

                if(part.length === 0){
                    continue;
                }

                let operator = null;
                let version = part;

                const match = part.match(/^([<>=!~^]+)?\s*(.+)?$/);
                if (match) {
                    operator = match[1] || null;
                    version = match[2] || part;
                }

                result = Version.matches(this, version, operator);
                if(!result) break;
            }

            if(result) return true;
        }

        return false;
    }

    static diff(versionA, versionB){
        versionA = versionA instanceof Version ? versionA : new Version(versionA);
        versionB = versionB instanceof Version ? versionB : new Version(versionB);

        // Compare major, minor, patch with wildcards
        let cmp = 
            (versionB.wildcardMask & 0b100? 0 : versionA.major - versionB.major) ||
            (versionB.wildcardMask & 0b010? 0 : versionA.minor - versionB.minor) ||
            (versionB.wildcardMask & 0b001? 0 : versionA.patch - versionB.patch)
        ;

        // Pre-releases are considered lower than normal releases
        if (cmp === 0) {
            const aPre = versionA.release != null && versionA.release !== "stable";
            const bPre = versionB.release != null && versionB.release !== "stable";

            if (aPre && !bPre) {
                cmp = -1;
            } else if (!aPre && bPre) {
                cmp = 1;
            } else if (aPre && bPre) {
                // Compare pre-release strings lexicographically
                cmp = String(versionA.release).localeCompare(String(versionB.release));
            }
        }

        return cmp;
    }

    static matches(versionA, versionB, operator = null){
        if(versionB === null || versionB === undefined){
            return false;
        }

        versionA = versionA instanceof Version ? versionA : new Version(versionA);
        versionB = versionB instanceof Version ? versionB : new Version(versionB);

        const cmp = Version.diff(versionA, versionB);

        switch(operator){
            case ">":
                return cmp > 0;

            case "<":
                return cmp < 0;

            case ">=":
                return cmp >= 0;

            case "<=":
                return cmp <= 0;

            case "!=":
                return cmp !== 0;

            case null: case "": case "=": case "==": case "===":
                return cmp === 0;

            case "*": case "any":
                return true;

            case "^":
                return (
                    versionA.major === versionB.major &&
                    (versionA.minor > versionB.minor ||
                    (versionA.minor === versionB.minor && versionA.patch >= versionB.patch))
                );

            case "~":
                return (
                    versionA.major === versionB.major &&
                    versionA.minor === versionB.minor &&
                    versionA.patch >= versionB.patch
                );

            default:
                throw new Error(`Invalid operator: ${operator}`);
        }
    }

    static isValid(versionString){
        if(typeof versionString !== 'string' || versionString.length === 0){
            return false;
        }

        let i = 0;
        const len = versionString.length;
        let dotCount = 0;
        let hasDigitInSegment = false;

        while(i < len){
            const char = versionString.charCodeAt(i);
            
            if(char >= 48 && char <= 57){ // 0-9
                hasDigitInSegment = true;
                i++;
            } else if(char === 46){ // .
                if(!hasDigitInSegment || dotCount >= 2){
                    return false;
                }
                dotCount++;
                hasDigitInSegment = false;
                i++;
            } else if(char === 45 || char === 43){ // - or +
                break; // Start of pre-release or build metadata
            } else if((char === 120 || char === 88) && !hasDigitInSegment){ // x or X (wildcard)
                hasDigitInSegment = true;
                i++;
            } else if(char === 42){ // * (wildcard)
                hasDigitInSegment = true;
                i++;
            } else {
                return false;
            }
        }

        if(!hasDigitInSegment){
            return false;
        }

        if(i < len && versionString.charCodeAt(i) === 45){
            i++;
            if(i >= len) return false;
            
            hasDigitInSegment = false;
            while(i < len){
                const char = versionString.charCodeAt(i);
                if((char >= 48 && char <= 57) || // 0-9
                   (char >= 65 && char <= 90) || // A-Z
                   (char >= 97 && char <= 122) || // a-z
                   char === 45 || char === 46){ // - or .
                    hasDigitInSegment = true;
                    i++;
                } else if(char === 43){ // +
                    break;
                } else {
                    return false;
                }
            }
            
            if(!hasDigitInSegment) return false;
        }

        if(i < len && versionString.charCodeAt(i) === 43){
            i++;
            if(i >= len) return false;
            
            hasDigitInSegment = false;
            while(i < len){
                const char = versionString.charCodeAt(i);
                if((char >= 48 && char <= 57) || // 0-9
                   (char >= 65 && char <= 90) || // A-Z
                   (char >= 97 && char <= 122) || // a-z
                   char === 45 || char === 46){ // - or .
                    hasDigitInSegment = true;
                    i++;
                } else {
                    return false;
                }
            }
            
            if(!hasDigitInSegment) return false;
        }

        return i === len;
    }

    // Some modules use it
    static coerce(versionString){
        if(typeof versionString !== 'string'){
            return null;
        }

        for(let i = 0; i < versionString.length; i++){
            const char = versionString.charCodeAt(i);
            if((char >= 48 && char <= 57)) { // 0-9
                return new Version(versionString.slice(i));
            }
        }
        return null;
    }
}
