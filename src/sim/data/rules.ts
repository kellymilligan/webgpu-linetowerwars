/** Match-wide rules and economy. Times are in seconds unless named in ticks. */
export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

export const START_LIVES = 30;
export const START_GOLD = 150;
export const START_INCOME = 20;
/** Income pays out on this timer. */
export const INCOME_PERIOD = 12;
/** Build-only time before the gates open and sends unlock. */
export const MUSTER_TIME = 30;

/** Neutral raids hit every lane on a timer and escalate. */
export const RAID_FIRST = 45;
export const RAID_PERIOD = 40;
/** Sudden death: raids speed up and harden fast after this. */
export const SUDDEN_DEATH = 25 * 60;
export const SUDDEN_DEATH_PERIOD = 12;

/** Gold the sender plunders when their creep breaks through, per life taken. */
export const PLUNDER_PER_LIFE = 2;
/**
 * A creep that breaks through its target's keep marches on into the next
 * holding, up to this many lanes in total; then it goes home with its loot.
 */
export const MAX_LANES = 2;
/** Seconds a creep spends marching between one lane's keep and the next gate. */
export const TRANSIT_TIME = 2.5;
/** Seconds between spawns within a send. */
export const SEND_SPACING = 0.35;

/** Breaching a tower costs creeps this many straight steps of detour when pathing. */
export const BREACH_COST = 12;

export const HOUSES: { name: string; colour: string }[] = [
  { name: 'Ashford', colour: '#c9a227' },
  { name: 'Varr', colour: '#b23a3a' },
  { name: 'Morrow', colour: '#3f6fb5' },
  { name: 'Thorne', colour: '#4d8a4a' },
  { name: 'Keld', colour: '#8a5bb0' },
  { name: 'Brack', colour: '#c7743a' },
  { name: 'Wyn', colour: '#3fa3a0' },
  { name: 'Orrin', colour: '#a8a8a0' },
];
