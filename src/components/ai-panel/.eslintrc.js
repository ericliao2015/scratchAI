module.exports = {
    rules: {
        // Prompts and user-facing messages are long strings; wrapping them hurts readability.
        'max-len': [2, 120, {ignoreStrings: true, ignoreTemplateLiterals: true, ignoreRegExpLiterals: true}]
    }
};
