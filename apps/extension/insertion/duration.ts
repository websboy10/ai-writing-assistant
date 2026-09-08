import { paceDelayMs } from './types';

/**
 * How long paced insertion of `chars` characters takes at `wpm`, in Danish.
 *
 * Exists because "Skriv ind i dokumentet" can start something that runs for
 * hours: a 60.000-tegn attachment — the cap on a single one — is 6 timer og
 * 40 minutter at the default 30 ord/min. A button that offers to do that
 * without saying so is a trap, and the number is not one anybody can estimate
 * in their head from "ord i minuttet".
 *
 * Deliberately coarse. The engine jitters every keystroke and adds a pause at
 * every sentence and paragraph, so a minute-accurate figure would be a
 * precision the run does not have; every caller says "ca." and means it.
 */
export function pacedDurationText(chars: number, wpm: number): string {
  const totalMinutes = Math.round((chars * paceDelayMs(wpm)) / 60_000);
  if (totalMinutes < 1) return 'under et minut';
  if (totalMinutes < 60) return `ca. ${totalMinutes} ${totalMinutes === 1 ? 'minut' : 'minutter'}`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hoursText = `${hours} ${hours === 1 ? 'time' : 'timer'}`;
  if (minutes === 0) return `ca. ${hoursText}`;
  return `ca. ${hoursText} og ${minutes} ${minutes === 1 ? 'minut' : 'minutter'}`;
}
