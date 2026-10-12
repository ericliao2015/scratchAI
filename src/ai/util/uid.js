// Same alphabet as scratch-blocks' Blockly.utils.genUid.
const SOUP = '!#$%()*+,-./:;=?@[]^_`{|}~ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * @returns {string} a random 20 character id, like the ones Scratch uses
 */
const uid = () => {
    let id = '';
    for (let i = 0; i < 20; i++) {
        id += SOUP.charAt(Math.floor(Math.random() * SOUP.length));
    }
    return id;
};

export default uid;
