/**
 * ArrayBuffer -> base64 without blowing the call stack on large projects.
 * @param {ArrayBuffer} buffer data
 * @returns {string} base64
 */
export const toBase64 = buffer => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
};

/**
 * @param {string} text base64
 * @returns {ArrayBuffer} data
 */
export const fromBase64 = text => {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
};
