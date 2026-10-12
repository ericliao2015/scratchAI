(function (Scratch) {
  class Weather {
    getInfo () {
      return {
        id: 'weathertest',
        name: 'Weather Test',
        blocks: [
          {opcode: 'temperature', blockType: Scratch.BlockType.REPORTER, text: 'temperature in [CITY]',
            arguments: {CITY: {type: Scratch.ArgumentType.STRING, menu: 'cities'}}},
          {opcode: 'setUnit', blockType: Scratch.BlockType.COMMAND, text: 'set unit to [UNIT] repeat [N]',
            arguments: {UNIT: {type: Scratch.ArgumentType.STRING, menu: 'units'}, N: {type: Scratch.ArgumentType.NUMBER, defaultValue: 3}}}
        ],
        menus: {cities: {acceptReporters: true, items: ['Taipei', 'Tainan']}, units: {items: ['C', 'F']}}
      };
    }
    temperature () { return 25; }
    setUnit () {}
  }
  Scratch.extensions.register(new Weather());
})(Scratch);
