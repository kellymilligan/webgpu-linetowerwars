/**
 * Siegeline actions for lobbyhop's N-browser e2e (ported from the old mp-e2e.mjs):
 *
 *   npm run build && npm run server            # wrangler dev on :8787, in another shell
 *   npx lobbyhop e2e --url http://localhost:8787/ -n 3 --seconds 70 --script scripts/e2e-actions.mjs
 *
 * Every player raises a wall during the muster; once the gates open, guests
 * send levies and footmen at their neighbour while the host keeps building.
 * Along the way each player orders a tower and screenshots it as a pending
 * ghost. lobbyhop then pauses, and compares tick and state hash across browsers.
 */
import { join, resolve } from 'node:path';

const out = resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'out/e2e');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ghostShot = new Set();

export async function act(page, i, round) {
  const info = await page.evaluate(() => {
    const { ctl } = window.ltw;
    const r = window.lobbyhop.room;
    return { phase: ctl.state.phase, seat: r.seat, host: r.host, paused: r.paused };
  });
  if (info.seat === null || info.paused || info.phase === 'over') return;

  if (round === 0) {
    // A serpentine start: a wall across the lane with an archer every third tile.
    await page.evaluate((row) => {
      const c = window.ltw.ctl;
      for (let x = 0; x < 10; x++) c.build(x, row, x % 3 ? 'palisade' : 'archer');
    }, 6 + 2 * (i % 2));
    return;
  }

  if (round === 3 + i && !ghostShot.has(i)) {
    // Order a tower and capture it while it's still pending (lobbyhop's room.pending → ghost).
    ghostShot.add(i);
    await page.evaluate(() => window.ltw.ctl.focusLane(window.ltw.ctl.me));
    await wait(150);
    await page.evaluate(() => {
      const { ctl, view } = window.ltw;
      // Close in on row 12 of our lane (world z = row - 17), snap the camera, then order.
      view.rig.focus(view.rig.goalTarget.x, 12.5 - 17, 26);
      view.rig.snap();
      // Simulate a laggy uplink: hold our outgoing frames for 10 s (in order), so the
      // orders stay pending long enough for a software-rendered screenshot.
      const send = WebSocket.prototype.send;
      const held = [];
      WebSocket.prototype.send = function (d) {
        held.push([this, d]);
      };
      setTimeout(() => {
        WebSocket.prototype.send = send;
        for (const [ws, d] of held) if (ws.readyState === 1) send.call(ws, d);
      }, 10_000);
      ctl.build(4, 12, 'palisade');
      ctl.build(5, 12, 'archer');
    });
    await wait(300);
    const pending = await page.evaluate(() => window.ltw.ctl.ghosts.length);
    await page.screenshot({ path: join(out, `ghost${i + 1}.png`) });
    console.log(`player ${i + 1}: ${pending} ghost(s) pending when captured`);
    return;
  }

  if (info.phase !== 'battle') return;
  if (info.host) {
    // The host shores up its maze every few seconds.
    if (round % 15 === 0) {
      await page.evaluate((r) => {
        const c = window.ltw.ctl;
        const y = 14 + ((r / 15) % 14);
        for (let x = 1; x < 11; x += 2) c.build(x, y, 'palisade');
      }, round);
    }
  } else if (round % 10 === i) {
    await page.evaluate(() => {
      window.ltw.ctl.send('levies');
      window.ltw.ctl.send('footmen');
    });
  }
  await wait(0);
}
