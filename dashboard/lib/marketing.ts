/**
 * Every public-facing string for the landing page lives here so the copy can be replaced
 * without touching markup. All facts come from the bot and dashboard code in this repo
 * (7-day trial in lib/constants.ts, 48h war in bot/cogs/war.py, 6 attacks per player,
 * Discord identify + guilds scopes in components/landing.tsx).
 *
 * Sample board values are fictional and marked as sample in the UI.
 */

export const site = {
  name: 'Legends Assistant',
  url: 'https://drlohithealth.com',
  description:
    'Track alliance wars, race nodes (OFA, DYP and JE), maze island discounts and player aliases for your Monster Legends alliance, from one dashboard.',
  supportEmail: 'warbot.support@gmail.com',
} as const

export const hero = {
  stamp: 'Alliance operations, tracked',
  title: "Run your alliance's wars, races and mazes without spreadsheets.",
  // Rendered in the accent colour inside the headline.
  titleAccent: 'without spreadsheets.',
  lede:
    'One dashboard for war phase timers, missing attacks, race nodes (OFA, DYP and JE), maze island discounts and player aliases. The board keeps the clock so your staff does not have to.',
  primaryCta: 'Start my free trial',
  // Returning staff already have a dashboard; the sign-in path must be as visible as the trial.
  loginCta: 'Sign in',
  loginNote:
    'Already tracking a server? Sign in with Discord to open your dashboard — same account, same server, trial unchanged.',
  secondaryCta: 'See what it tracks',
  // Quantified effort: remove the "how long will this take?" objection before it forms.
  effortNote: 'Live in about a minute: sign in with Discord, pick your server, the board fills.',
  highlights: ['7-day free trial', 'No card required', 'Admins and managers only'],
  scopeNote:
    'We request identify and guilds only. No messages or member data are read by the dashboard.',
} as const

export const clock = {
  stamp: '02 / War clock',
  title: 'Defence for 24 hours. Attack for 24. The board switches for you.',
  body:
    'The in-game war clock runs 48h to 0h. The bot moves the board from defence to attack on its own, pings the channel at the switch, and keeps the missing list in front of the people who can fix it.',
  facts: [
    { value: '48h', label: 'war clock, start to end' },
    { value: '24h', label: 'defence holds the first half' },
    { value: '24h', label: 'attack takes the last half' },
    { value: '6', label: 'attacks required per player' },
  ],
  localTimeLabel: 'Your local time, used for maze discounts',
  rail: {
    start: '48h left',
    mid: '24h left',
    end: '0h',
    defence: 'Defence',
    attack: 'Attack',
  },
} as const

export const features = {
  stamp: '03 / On the board',
  title: 'Everything the alliance argues about, in one place.',
  lede:
    'Six tools, one source of truth. No pinned spreadsheet, no guessing which timer is current.',
  items: [
    {
      id: '01',
      name: 'War phase timers',
      tag: 'War / live',
      description:
        'Defence and attack countdowns that follow the 48h clock, with automatic phase switches and channel pings.',
    },
    {
      id: '02',
      name: 'Missing attacks',
      tag: 'War / attendance',
      description:
        'The missing and excused lists, player by player, with warnings while there is still time to fix them.',
    },
    {
      id: '03',
      name: 'Attack log',
      tag: 'War / log',
      description:
        'Players log attacks in Discord. Staff approve, undo or correct a count without losing the record.',
    },
    {
      id: '04',
      name: 'Race nodes',
      tag: 'Race',
      description:
        'Lap and node progress for OFA, DYP and JE, with live status and staff overrides when a screenshot is unclear.',
    },
    {
      id: '05',
      name: 'Maze discounts',
      tag: 'Maze',
      description:
        'Every discount moment on the maze schedule, converted to your local time, with pings straight to the channel.',
    },
    {
      id: '06',
      name: 'Aliases',
      tag: 'Roster',
      description:
        'Map in-game names to Discord members once. No accidental mentions and no duplicate records.',
    },
  ],
} as const

export type StartStep = {
  id: string
  title: string
  body: string
  command?: string
  altCommand?: string
}

export const start: { stamp: string; title: string; steps: StartStep[] } = {
  stamp: '04 / Start',
  title: 'Three steps, one command.',
  steps: [
    {
      id: '01',
      title: 'Put the bot in the server',
      body:
        'You need Manage Server or Administrator. The bot only needs the channel you use for war calls.',
    },
    {
      id: '02',
      title: 'Start the war in Discord',
      body:
        'Name the phase and the time left. The bot back-dates the start so the board matches the phase you named.',
      command: '!war defence ends 24h',
      altCommand: '!war attack ends 20h',
    },
    {
      id: '03',
      title: 'Open the board',
      body:
        'Sign in with Discord and the server appears in your list. The dashboard checks your permissions before it loads anything.',
    },
  ],
}

export const faq = {
  stamp: '05 / Questions',
  title: 'The things staff ask before they sign in.',
  items: [
    {
      q: 'Is it free?',
      a: 'Every server starts with a 7-day trial and every feature unlocked. No card is required to start it. After the trial, the server keeps its board and history and needs an active plan to run the bot.',
    },
    {
      q: 'Which permissions does it ask for?',
      a: 'Discord identify and guilds, so sign-in can list the servers you manage. The dashboard does not read messages or member data. The bot reads only the channel it is configured to track.',
    },
    {
      q: 'Which parts of the game does it track?',
      a: 'Alliance wars, race nodes (OFA, DYP and JE), maze island discounts and player aliases.',
    },
    {
      q: 'Does the bot play the game for us?',
      a: 'No. It tracks what you and your staff report in Discord: attack calls, absences, race uploads and maze timings. It does not automate gameplay.',
    },
    {
      q: 'Can a player see the whole server?',
      a: 'Only members with Manage Server or Administrator can open a server dashboard. Players do not need a dashboard login to post attack calls in Discord.',
    },
  ],
} as const

export const finale = {
  title: 'Put it on the board.',
  body:
    'Sign in with Discord, start the trial and run the next war, race and maze from one place.',
  cta: 'Start my free trial',
  secondaryCta: 'Sign in to my dashboard',
} as const

export const footer = {
  disclaimer:
    'Community project. Not affiliated with Monster Legends or Socialpoint.',
  colophon: 'Type: Archivo and JetBrains Mono. Built with Next.js, Supabase and Discord.',
  links: [
    { label: 'Terms', href: '/legal' },
    { label: 'Refund policy', href: '/legal#refund' },
    { label: 'Privacy', href: '/legal' },
  ],
} as const

/**
 * Fictional sample data for the live hero board. It is labelled "sample" in the UI and is
 * never presented as a real server, real players or real war results.
 */
export const sampleBoard = {
  serverLabel: 'Sample server',
  players: [
    { name: 'Kael', attacks: 6 },
    { name: 'Mira', attacks: 6 },
    { name: 'Enzo', attacks: 5 },
    { name: 'Tobi', attacks: 2 },
  ],
  counts: { missing: 2, excused: 1, logged: 5 },
  attacksRequired: 6,
} as const
