module.exports = [
  {
    key: 'charizard',
    name: 'Glurak',
    emoji: '🔥',
    bossPower: 100,
    intro: 'Ein wildes Glurak kreist über dem Camp und sucht die Konfrontation.',
    rewards: {
      win: {
        xp: [14, 20],
        food: [5, 7],
        stone: [1, 3],
        ore: [3, 4],
        scrap: [2, 3]
      },
      lose: {
        xp: [5, 8]
      }
    }
  },
  {
    key: 'mewtwo',
    name: 'Mewtu',
    emoji: '🧠',
    bossPower: 120,
    intro: 'Mewtu wurde vom Lager angelockt und testet die Stärke des Camps.',
    rewards: {
      win: {
        xp: [18, 24],
        food: [5, 9],
        ore: [3, 4],
        fiber: [2, 4],
        scrap: [2, 3]
      },
      lose: {
        xp: [6, 9]
      }
    }
  },
  {
    key: 'kyogre',
    name: 'Kyogre',
    emoji: '🌊',
    bossPower: 105,
    intro: 'Kyogre taucht aus der Tiefe auf und bedroht die Vorräte des Camps.',
    rewards: {
      win: {
        xp: [16, 22],
        food: [4, 8],
        stone: [2, 3],
        ore: [3, 4]
      },
      lose: {
        xp: [5, 8]
      }
    }
  },
  {
    key: 'tyranitar',
    name: 'Despotar',
    emoji: '🪨',
    bossPower: 103,
    intro: 'Ein Despotar wütet in der Nähe und muss gemeinsam gestoppt werden.',
    rewards: {
      win: {
        xp: [15, 21],
        food: [1, 3],
        stone: [5, 10],
        ore: [2, 4]
      },
      lose: {
        xp: [5, 8]
      }
    }
  },
  {
    key: 'dragonite',
    name: 'Dragoran',
    emoji: '🐉',
    bossPower: 106,
    intro: 'Ein mächtiges Dragoran wurde auf das Camp aufmerksam.',
    rewards: {
      win: {
        xp: [16, 22],
        food: [5, 7],
        fiber: [1, 3],
        scrap: [1, 2]
      },
      lose: {
        xp: [5, 8]
      }
    }
  },
  {
    key: 'zapdos',
    name: 'Zapdos',
    emoji: '⚡',
    bossPower: 104,
    intro: 'Zapdos entlädt seine Energie über dem Camp.',
    rewards: {
      win: {
        xp: [17, 23],
        food: [2, 5],
        ore: [3, 4],
        fiber: [3, 4],
        scrap: [4, 6]
      },
      lose: {
        xp: [6, 9]
      }
    }
  }
];
