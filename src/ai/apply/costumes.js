/**
 * Resolves IR costume specs ({library}, {svg}, {generate}, resolved image data) into
 * costume data the VM can load.
 */
import {soundAsset, soundFromSpec} from '../audio/index.js';

const encoder = typeof TextEncoder === 'undefined' ? null : new TextEncoder();

const toBytes = text => {
    if (encoder) return encoder.encode(text);
    // eslint-disable-next-line no-undef
    return new Uint8Array(Buffer.from(text, 'utf8'));
};

const PALETTE = ['#4C97FF', '#9966FF', '#CF63CF', '#FFBF00', '#FFAB19', '#5CB1D6', '#59C059', '#FF8C1A', '#FF6680'];

const hash = text => {
    let h = 0;
    for (const ch of String(text)) h = ((h * 31) + ch.codePointAt(0)) >>> 0;
    return h;
};

const escapeXml = text => String(text).replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', '\'': '&apos;'
}[c]));

/**
 * A simple colored circle with the sprite's first letter, used when no costume is given.
 * @param {string} name sprite name
 * @returns {string} SVG
 */
export const placeholderSvg = name => {
    const color = PALETTE[hash(name) % PALETTE.length];
    const letter = escapeXml(Array.from(String(name || '?'))[0] || '?');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
        `<circle cx="40" cy="40" r="36" fill="${color}" stroke="#ffffff" stroke-width="4"/>` +
        `<text x="40" y="52" font-size="34" font-family="sans-serif" text-anchor="middle" fill="#ffffff">${letter}</text>` +
        '</svg>';
};

/**
 * Work out an SVG's size so the costume can be centered.
 * @param {string} svg SVG text
 * @returns {{width: number, height: number}} size
 */
export const svgSize = svg => {
    const attr = name => {
        const match = new RegExp(`<svg[^>]*\\s${name}="([\\d.]+)`, 'i').exec(svg);
        return match ? Number(match[1]) : null;
    };
    const viewBox = /<svg[^>]*\sviewBox="[\d.\-\s]+?\s([\d.]+)\s+([\d.]+)"/i.exec(svg);
    const width = attr('width') || (viewBox ? Number(viewBox[1]) : 100);
    const height = attr('height') || (viewBox ? Number(viewBox[2]) : 100);
    return {width, height};
};

const normalize = text => String(text).toLowerCase()
    .replace(/[\s_-]+/g, '');

/**
 * Find library items by name. Accepts sprite names ("Cat" -> all its costumes),
 * costume names ("Cat-a") and backdrop names ("Blue Sky").
 * @param {string} name requested name
 * @param {object} libraries {costumes, sprites, backdrops}
 * @param {boolean} isBackdrop look in backdrops first
 * @returns {Array<object>} library costume entries
 */
export const findLibraryCostumes = (name, libraries, isBackdrop) => {
    const wanted = normalize(name);
    const exact = list => (list || []).filter(item => normalize(item.name) === wanted);
    const prefix = list => (list || []).filter(item => normalize(item.name).startsWith(wanted));
    if (isBackdrop) {
        const backdrop = exact(libraries.backdrops)[0] || prefix(libraries.backdrops)[0];
        if (backdrop) return [backdrop];
    }
    const costume = exact(libraries.costumes)[0];
    if (costume) return [costume];
    const sprite = exact(libraries.sprites)[0] || prefix(libraries.sprites)[0];
    if (sprite && sprite.costumes && sprite.costumes.length) return sprite.costumes;
    const costumePrefix = prefix(libraries.costumes)[0];
    if (costumePrefix) return [costumePrefix];
    if (!isBackdrop) {
        const backdrop = exact(libraries.backdrops)[0];
        if (backdrop) return [backdrop];
    }
    return [];
};

/**
 * @param {object} spec IR costume spec
 * @param {object} options {storage, libraries, generateImage, isBackdrop, fallbackName}
 * @returns {Promise<Array<object>>} resolved costumes {name, dataFormat, data, rotationCenterX,
 *   rotationCenterY, bitmapResolution}
 */
export const resolveCostume = async (spec, {storage, libraries, generateImage, isBackdrop = false, fallbackName = ''}) => {
    if (typeof spec === 'string') spec = {library: spec};
    if (!spec || typeof spec !== 'object') return [];

    if (spec.data && spec.dataFormat) {
        return [{
            name: spec.name || fallbackName || 'costume1',
            dataFormat: spec.dataFormat,
            data: spec.data,
            rotationCenterX: spec.rotationCenterX,
            rotationCenterY: spec.rotationCenterY,
            bitmapResolution: spec.bitmapResolution || (spec.dataFormat === 'svg' ? 1 : 2)
        }];
    }

    if (typeof spec.svg === 'string' && spec.svg.includes('<svg')) {
        const size = svgSize(spec.svg);
        return [{
            name: spec.name || fallbackName || 'costume1',
            dataFormat: 'svg',
            data: toBytes(spec.svg),
            rotationCenterX: size.width / 2,
            rotationCenterY: size.height / 2,
            bitmapResolution: 1
        }];
    }

    if (spec.generate && generateImage) {
        const image = await generateImage(spec.generate, {isBackdrop});
        return image ? [{name: spec.name || fallbackName || 'costume1', ...image}] : [];
    }

    if (spec.library && libraries && storage) {
        const items = findLibraryCostumes(spec.library, libraries, isBackdrop);
        const results = [];
        for (const item of items) {
            const type = item.dataFormat === 'svg' ? storage.AssetType.ImageVector : storage.AssetType.ImageBitmap;
            const asset = await storage.load(type, item.assetId, item.dataFormat);
            if (!asset) continue;
            results.push({
                name: items.length === 1 && spec.name ? spec.name : item.name,
                dataFormat: item.dataFormat,
                data: asset.data,
                rotationCenterX: item.rotationCenterX,
                rotationCenterY: item.rotationCenterY,
                bitmapResolution: item.bitmapResolution || 1
            });
        }
        return results;
    }
    return [];
};

export const placeholderCostume = name => {
    const svg = placeholderSvg(name);
    return {
        name: 'costume1',
        dataFormat: 'svg',
        data: toBytes(svg),
        rotationCenterX: 40,
        rotationCenterY: 40,
        bitmapResolution: 1
    };
};

/**
 * Resolve an IR sound spec ({library: "Meow"} or "Meow") from the sound library.
 * @param {object|string} spec sound spec
 * @param {object} options {storage, libraries}
 * @returns {Promise<?object>} sound {name, assetId, ext, rate, sampleCount, asset}, or null
 */
export const resolveSound = async (spec, {storage, libraries}) => {
    if (typeof spec === 'string') spec = {library: spec};
    // Synthesized effects and loop music ({"sfx": "jump"}, {"music": "happy"}).
    const generated = storage && soundFromSpec(spec);
    if (generated) return soundAsset(storage, generated);
    if (!spec || !spec.library || !libraries || !storage) return null;
    const wanted = normalize(spec.library);
    const list = libraries.sounds || [];
    const item = list.find(s => normalize(s.name) === wanted) || list.find(s => normalize(s.name).startsWith(wanted));
    if (!item) return null;
    const ext = (item.md5ext || '').split('.').pop() || item.dataFormat || 'wav';
    const asset = await storage.load(storage.AssetType.Sound, item.assetId, ext);
    if (!asset) return null;
    return {
        name: spec.name || item.name,
        assetId: item.assetId,
        ext,
        rate: item.rate,
        sampleCount: item.sampleCount,
        asset
    };
};
