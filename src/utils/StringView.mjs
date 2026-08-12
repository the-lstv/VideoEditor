export default class StringView extends Uint8Array {
    isView = true;

    constructor(buf, byteOffset = 0, length) {
        if (buf instanceof Uint8Array) {
            super(buf.buffer, buf.byteOffset + byteOffset, length ?? (buf.length - byteOffset));
        } else if (buf instanceof ArrayBuffer) {
            super(buf, byteOffset, length);
        } else {
            throw new TypeError("Expected ArrayBuffer or Uint8Array");
        }
    }

    charCodeAt(index) {
        return this[index];
    }

    substring(start = 0, end = this.length) {
        let s = start < 0 ? this.length + start : start;
        let e = end < 0 ? this.length + end : end;
        s = Math.max(0, s);
        e = Math.min(this.length, e);
        if (e < s) e = s;
        return new StringView(this.buffer, this.byteOffset + s, e - s);
    }

    toString() {
        return new TextDecoder().decode(this);
    }

    static fromString(str) {
        const encoder = new TextEncoder();
        return StringView.fromBuffer(encoder.encode(str));
    }

    /**
     * Creates a zero-copy StringView from an ArrayBuffer or Uint8Array
     * If the input is already a StringView, it is returned as-is
     * @param {ArrayBuffer|Uint8Array|StringView} buffer The buffer to create a StringView from
     * @return {StringView} The created StringView
     */
    static fromBuffer(buffer) {
        if(buffer instanceof StringView) {
            return buffer;
        }

        return new StringView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }
}