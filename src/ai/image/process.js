/**
 * Post-processing that turns a generated picture into a good Scratch costume:
 * background removal, trimming, centering, scaling, flipping, vectorizing, compressing.
 *
 * The pixel algorithms work on ImageData-like objects ({width, height, data}) so they
 * can be unit tested without a browser; the canvas helpers need a DOM.
 */

const STAGE_WIDTH = 480;
const STAGE_HEIGHT = 360;

const colorDistance = (data, i, color) => {
    const dr = data[i] - color[0];
    const dg = data[i + 1] - color[1];
    const db = data[i + 2] - color[2];
    return Math.sqrt((dr * dr) + (dg * dg) + (db * db));
};

/**
 * Guess the background color from the image border (most common quantized color).
 * @param {object} image ImageData-like
 * @returns {number[]} [r, g, b]
 */
export const borderColor = image => {
    const {width, height, data} = image;
    const counts = new Map();
    const sample = (x, y) => {
        const i = ((y * width) + x) * 4;
        if (data[i + 3] < 128) return;
        const key = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`;
        const entry = counts.get(key) || {n: 0, r: 0, g: 0, b: 0};
        entry.n += 1;
        entry.r += data[i];
        entry.g += data[i + 1];
        entry.b += data[i + 2];
        counts.set(key, entry);
    };
    for (let x = 0; x < width; x++) {
        sample(x, 0);
        sample(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
        sample(0, y);
        sample(width - 1, y);
    }
    let best = null;
    for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
    if (!best) return [255, 255, 255];
    return [best.r / best.n, best.g / best.n, best.b / best.n];
};

/**
 * Make the background transparent by flood filling from the edges.
 * Pixels close to the background color but not reached by the fill (e.g. white eyes)
 * are kept. Edge pixels get partial transparency for smoother outlines.
 * @param {object} image ImageData-like, modified in place
 * @param {object} [options] {tolerance}
 * @returns {{removed: number, color: number[]}} stats
 */
export const removeBackground = (image, {tolerance = 48} = {}) => {
    const {width, height, data} = image;
    const color = borderColor(image);
    const visited = new Uint8Array(width * height);
    const stack = [];
    const push = (x, y) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        const p = (y * width) + x;
        if (visited[p]) return;
        const i = p * 4;
        if (data[i + 3] !== 0 && colorDistance(data, i, color) > tolerance) return;
        visited[p] = 1;
        stack.push(p);
    };
    for (let x = 0; x < width; x++) {
        push(x, 0);
        push(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
        push(0, y);
        push(width - 1, y);
    }
    let removed = 0;
    while (stack.length) {
        const p = stack.pop();
        data[(p * 4) + 3] = 0;
        removed += 1;
        const x = p % width;
        const y = (p - x) / width;
        push(x + 1, y);
        push(x - 1, y);
        push(x, y + 1);
        push(x, y - 1);
    }
    // Soften the outline: partially transparent where the color is still near the background.
    for (let p = 0; p < width * height; p++) {
        if (visited[p]) continue;
        const x = p % width;
        const y = (p - x) / width;
        const touchesBackground = (x > 0 && visited[p - 1]) || (x < width - 1 && visited[p + 1]) ||
            (y > 0 && visited[p - width]) || (y < height - 1 && visited[p + width]);
        if (!touchesBackground) continue;
        const i = p * 4;
        const distance = colorDistance(data, i, color);
        if (distance < tolerance * 2) {
            data[i + 3] = Math.round(data[i + 3] * Math.min(1, ((distance - tolerance) / tolerance) + 0.35));
        }
    }
    return {removed, color};
};

/**
 * Bounding box of non-transparent pixels.
 * @param {object} image ImageData-like
 * @param {number} [threshold] alpha threshold
 * @returns {?{x: number, y: number, width: number, height: number}} box, or null when empty
 */
export const opaqueBounds = (image, threshold = 8) => {
    const {width, height, data} = image;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(((y * width) + x) * 4) + 3] > threshold) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) return null;
    return {x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1};
};

// ---- browser helpers -------------------------------------------------------

const createCanvas = (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
};

/**
 * @param {Uint8Array|Blob} bytes image file
 * @returns {Promise<HTMLCanvasElement>} decoded image on a canvas
 */
export const decodeImage = async bytes => {
    const blob = bytes instanceof Blob ? bytes : new Blob([bytes]);
    const url = URL.createObjectURL(blob);
    try {
        const image = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('無法讀取圖片'));
            img.src = url;
        });
        const canvas = createCanvas(image.naturalWidth, image.naturalHeight);
        canvas.getContext('2d').drawImage(image, 0, 0);
        return canvas;
    } finally {
        URL.revokeObjectURL(url);
    }
};

const canvasToBytes = canvas => new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
        if (!blob) {
            reject(new Error('無法輸出圖片'));
            return;
        }
        blob.arrayBuffer().then(buffer => resolve(new Uint8Array(buffer)), reject);
    }, 'image/png');
});

const cropCanvas = (canvas, box) => {
    const out = createCanvas(box.width, box.height);
    out.getContext('2d').drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
    return out;
};

const scaleCanvas = (canvas, width, height) => {
    const out = createCanvas(width, height);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    return out;
};

const flipCanvas = canvas => {
    const out = createCanvas(canvas.width, canvas.height);
    const ctx = out.getContext('2d');
    ctx.translate(out.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(canvas, 0, 0);
    return out;
};

/**
 * Cover-crop to the stage's 4:3 shape at twice the stage resolution.
 * @param {HTMLCanvasElement} canvas image
 * @returns {HTMLCanvasElement} backdrop
 */
const fitBackdrop = canvas => {
    const width = STAGE_WIDTH * 2;
    const height = STAGE_HEIGHT * 2;
    const scale = Math.max(width / canvas.width, height / canvas.height);
    const out = createCanvas(width, height);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    const w = canvas.width * scale;
    const h = canvas.height * scale;
    ctx.drawImage(canvas, (width - w) / 2, (height - h) / 2, w, h);
    return out;
};

const vectorize = async (canvas, colors) => {
    const {default: ImageTracer} = await import(/* webpackChunkName: "imagetracer" */ 'imagetracerjs');
    const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const svg = ImageTracer.imagedataToSVG(imageData, {
        numberofcolors: colors,
        colorquantcycles: 3,
        ltres: 1,
        qtres: 1,
        pathomit: 8,
        roundcoords: 1,
        viewbox: false
    });
    return new TextEncoder().encode(svg);
};

/**
 * Reduce colors so the PNG compresses better (posterize).
 * @param {HTMLCanvasElement} canvas image, changed in place
 * @param {number} levels levels per channel
 */
const posterize = (canvas, levels = 32) => {
    const ctx = canvas.getContext('2d');
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const step = 256 / levels;
    for (let i = 0; i < image.data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
            image.data[i + c] = Math.min(255, Math.round((Math.floor(image.data[i + c] / step) * step) + (step / 2)));
        }
    }
    ctx.putImageData(image, 0, 0);
};

export const DEFAULT_OPTIONS = {
    kind: 'sprite',
    removeBackground: true,
    tolerance: 48,
    trim: true,
    center: true,
    scale: true,
    size: 120,
    flip: false,
    vectorize: false,
    vectorColors: 16,
    compress: true
};

/**
 * @param {Uint8Array} bytes generated image file
 * @param {object} options see DEFAULT_OPTIONS
 * @returns {Promise<Array<object>>} costumes {name, dataFormat, data, rotationCenterX, rotationCenterY,
 *   bitmapResolution, previewUrl}
 */
export const processImage = async (bytes, options = {}) => {
    const opts = {...DEFAULT_OPTIONS, ...options};
    let canvas = await decodeImage(bytes);

    if (opts.kind === 'backdrop') {
        canvas = fitBackdrop(canvas);
    } else {
        if (opts.removeBackground) {
            const ctx = canvas.getContext('2d');
            const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
            removeBackground(image, {tolerance: opts.tolerance});
            ctx.putImageData(image, 0, 0);
        }
        if (opts.trim) {
            const ctx = canvas.getContext('2d');
            const box = opaqueBounds(ctx.getImageData(0, 0, canvas.width, canvas.height));
            if (box) canvas = cropCanvas(canvas, box);
        }
        if (opts.scale) {
            // Costumes are stored at 2x so they stay sharp in full screen.
            const longSide = Math.max(16, Number(opts.size) || 120) * 2;
            const ratio = longSide / Math.max(canvas.width, canvas.height);
            canvas = scaleCanvas(canvas, canvas.width * ratio, canvas.height * ratio);
        }
    }
    if (opts.compress && !opts.vectorize) posterize(canvas);

    const variants = [{canvas, suffix: ''}];
    if (opts.flip && opts.kind !== 'backdrop') variants.push({canvas: flipCanvas(canvas), suffix: '-flipped'});

    const results = [];
    for (const variant of variants) {
        const c = variant.canvas;
        const center = opts.center || opts.kind === 'backdrop';
        let costume;
        if (opts.vectorize) {
            // Vector costumes are measured in stage units (half the 2x bitmap).
            const half = scaleCanvas(c, c.width / 2, c.height / 2);
            costume = {
                dataFormat: 'svg',
                data: await vectorize(half, opts.vectorColors),
                bitmapResolution: 1,
                rotationCenterX: center ? half.width / 2 : 0,
                rotationCenterY: center ? half.height / 2 : 0
            };
        } else {
            costume = {
                dataFormat: 'png',
                data: await canvasToBytes(c),
                bitmapResolution: 2,
                rotationCenterX: center ? c.width / 2 : 0,
                rotationCenterY: center ? c.height / 2 : 0
            };
        }
        costume.suffix = variant.suffix;
        costume.previewUrl = c.toDataURL('image/png');
        results.push(costume);
    }
    return results;
};

/**
 * Size string for the image API.
 * @param {string} kind 'sprite' or 'backdrop'
 * @returns {string} size such as 1024x1024
 */
export const imageSize = kind => (kind === 'backdrop' ? '1024x768' : '1024x1024');
